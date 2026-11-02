import {
  AdapterArgs,
  AdapterResult,
  StreamEvent,
  UpstreamAdapter,
  openAiChunk,
} from '../types';
import { UpstreamError, isRetryableStatus } from '../upstream-error';
import { upstreamFetch, readUpstreamError } from './http';
import { parseSse } from './sse';

function buildUrl(provider: any, upstreamModel: string, stream: boolean, apiKey: string) {
  const base = provider.baseUrl.replace(/\/+$/, '');
  const action = stream ? 'streamGenerateContent' : 'generateContent';
  const url = new URL(`${base}/models/${encodeURIComponent(upstreamModel)}:${action}`);
  url.searchParams.set('key', apiKey);
  if (stream) url.searchParams.set('alt', 'sse');
  return url.toString();
}

function mapParts(content: any): any[] {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: String(content ?? '') }];
  const parts: any[] = [];
  for (const part of content) {
    if (part?.type === 'text') parts.push({ text: part.text || '' });
    else if (part?.type === 'image_url') {
      const url = String(part.image_url?.url || '');
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      } else if (url) {
        parts.push({ fileData: { mimeType: 'image/*', fileUri: url } });
      }
    }
  }
  return parts;
}

function mapContents(messages: any[] = []) {
  const system: string[] = [];
  const contents: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const text = typeof m.content === 'string' ? m.content : mapParts(m.content).map((p) => p.text || '').join('');
      if (text) system.push(text);
      continue;
    }
    if (m.role === 'tool') continue;
    const parts = mapParts(m.content);
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const call of m.tool_calls) {
        let args: any = {};
        try {
          args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: call.function?.name, args } });
      }
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return { system, contents };
}

function mapFinish(reason: string | undefined | null) {
  switch (reason) {
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
      return 'content_filter';
    case 'STOP':
    default:
      return 'stop';
  }
}

function mapUsage(meta: any) {
  if (!meta) return undefined;
  const promptTokens = Number(meta.promptTokenCount || 0);
  const completionTokens = Number(meta.candidatesTokenCount || 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens: Number(meta.totalTokenCount || promptTokens + completionTokens),
  };
}

export class GeminiAdapter implements UpstreamAdapter {
  private payload(args: AdapterArgs) {
    const { body } = args;
    const { system, contents } = mapContents(body.messages);
    const generationConfig: any = {};
    if (body.temperature !== undefined) generationConfig.temperature = body.temperature;
    if (body.top_p !== undefined) generationConfig.topP = body.top_p;
    if (body.max_tokens !== undefined) generationConfig.maxOutputTokens = body.max_tokens;
    if (body.max_completion_tokens !== undefined) generationConfig.maxOutputTokens = body.max_completion_tokens;
    if (body.stop) generationConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
    if (body.response_format?.type === 'json_object') generationConfig.responseMimeType = 'application/json';

    const tools = Array.isArray(body.tools)
      ? [
          {
            functionDeclarations: body.tools
              .filter((t: any) => t?.type === 'function' && t.function)
              .map((t: any) => ({
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
              })),
          },
        ]
      : undefined;

    return {
      contents,
      ...(system.length ? { systemInstruction: { parts: [{ text: system.join('\n\n') }] } } : {}),
      ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
      ...(tools?.length ? { tools } : {}),
    };
  }

  async chat(args: AdapterArgs): Promise<AdapterResult> {
    const { provider, apiKey, signal, timeoutMs } = args;
    const res = await upstreamFetch(
      buildUrl(provider, args.upstreamModel, false, apiKey),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(this.payload(args)),
      },
      timeoutMs,
      signal,
    );
    if (!res.ok) {
      throw new UpstreamError(await readUpstreamError(res), res.status, isRetryableStatus(res.status));
    }
    const json: any = await res.json();
    const candidate = json.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
    const toolCalls = parts
      .filter((p: any) => p.functionCall)
      .map((p: any, index: number) => ({
        index,
        id: `call_${Date.now()}_${index}`,
        type: 'function',
        function: {
          name: p.functionCall.name,
          arguments: JSON.stringify(p.functionCall.args || {}),
        },
      }));
    const usage = mapUsage(json.usageMetadata);
    const id = `gemini-${Date.now()}`;
    return {
      response: {
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: args.upstreamModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: text || null,
              ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
            },
            finish_reason: mapFinish(candidate?.finishReason),
          },
        ],
        usage: usage
          ? {
              prompt_tokens: usage.promptTokens,
              completion_tokens: usage.completionTokens,
              total_tokens: usage.totalTokens,
            }
          : undefined,
      },
      usage,
      upstreamRequestId: id,
    };
  }

  async *chatStream(args: AdapterArgs): AsyncGenerator<StreamEvent> {
    const { provider, apiKey, signal, timeoutMs } = args;
    const res = await upstreamFetch(
      buildUrl(provider, args.upstreamModel, true, apiKey),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(this.payload(args)),
      },
      timeoutMs,
      signal,
    );
    if (!res.ok) {
      throw new UpstreamError(await readUpstreamError(res), res.status, isRetryableStatus(res.status));
    }

    const id = `gemini-${Date.now()}`;
    const model = args.upstreamModel;
    let usage: any;
    let finishReason: string | null = null;
    let sentRole = false;

    for await (const event of parseSse(res.body)) {
      if (event.data === '[DONE]') break;
      let json: any;
      try {
        json = JSON.parse(event.data);
      } catch {
        continue;
      }
      const candidate = json.candidates?.[0];
      if (json.usageMetadata) usage = mapUsage(json.usageMetadata);
      if (!sentRole && candidate) {
        sentRole = true;
        yield {
          chunk: openAiChunk({ id, model, delta: { role: 'assistant' } }),
          upstreamRequestId: id,
        };
      }
      if (candidate?.finishReason) finishReason = mapFinish(candidate.finishReason);
      const parts = candidate?.content?.parts || [];
      for (const part of parts) {
        if (part.text) {
          yield {
            chunk: openAiChunk({ id, model, delta: { content: part.text } }),
            text: part.text,
            upstreamRequestId: id,
          };
        } else if (part.functionCall) {
          yield {
            chunk: openAiChunk({
              id,
              model,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `call_${Date.now()}`,
                    type: 'function',
                    function: {
                      name: part.functionCall.name,
                      arguments: JSON.stringify(part.functionCall.args || {}),
                    },
                  },
                ],
              },
            }),
            upstreamRequestId: id,
          };
        }
      }
    }

    yield {
      chunk: openAiChunk({
        id,
        model,
        delta: {},
        finishReason: finishReason || 'stop',
        usage,
      }),
      usage,
      finishReason: finishReason || 'stop',
      upstreamRequestId: id,
    };
  }
}
