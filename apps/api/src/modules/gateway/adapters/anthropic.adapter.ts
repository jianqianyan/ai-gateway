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

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function textFromContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p?.type === 'text')
      .map((p: any) => p.text || '')
      .join('');
  }
  return '';
}

function mapImage(part: any): any | null {
  const url = part?.image_url?.url;
  if (!url) return null;
  const match = String(url).match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: match[1], data: match[2] },
    };
  }
  return { type: 'image', source: { type: 'url', url } };
}

function mapContent(content: any): any {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  const blocks: any[] = [];
  for (const part of content) {
    if (part?.type === 'text') blocks.push({ type: 'text', text: part.text || '' });
    else if (part?.type === 'image_url') {
      const image = mapImage(part);
      if (image) blocks.push(image);
    }
  }
  return blocks.length ? blocks : '';
}

function mapMessages(messages: any[] = []) {
  const system: string[] = [];
  const mapped: any[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      const text = textFromContent(m.content);
      if (text) system.push(text);
      continue;
    }

    if (m.role === 'tool') {
      mapped.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.tool_call_id,
            content: textFromContent(m.content),
          },
        ],
      });
      continue;
    }

    const content = mapContent(m.content);
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const blocks: any[] = [];
      const text = textFromContent(m.content);
      if (text) blocks.push({ type: 'text', text });
      for (const call of m.tool_calls) {
        let input: any = {};
        try {
          input = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          input = {};
        }
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.function?.name,
          input,
        });
      }
      mapped.push({ role: 'assistant', content: blocks });
    } else {
      mapped.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content,
      });
    }
  }

  return { system, messages: mapped };
}

function mapTools(tools: any[]) {
  if (!Array.isArray(tools)) return undefined;
  return tools
    .filter((t) => t?.type === 'function' && t.function)
    .map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters || { type: 'object', properties: {} },
    }));
}

function mapToolChoice(choice: any) {
  if (!choice) return undefined;
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'required') return { type: 'any' };
  if (choice === 'none') return undefined;
  if (choice?.type === 'function') return { type: 'tool', name: choice.function?.name };
  return undefined;
}

function mapStopReason(reason: string | null | undefined) {
  switch (reason) {
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'stop_sequence':
    case 'end_turn':
    default:
      return 'stop';
  }
}

export class AnthropicAdapter implements UpstreamAdapter {
  private payload(args: AdapterArgs) {
    const { body, upstreamModel } = args;
    const { system, messages } = mapMessages(body.messages);
    return {
      model: upstreamModel,
      max_tokens: body.max_tokens ?? body.max_completion_tokens ?? 4096,
      messages,
      ...(system.length ? { system: system.join('\n\n') } : {}),
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
      ...(body.stop ? { stop_sequences: Array.isArray(body.stop) ? body.stop : [body.stop] } : {}),
      ...(body.tools ? { tools: mapTools(body.tools) } : {}),
      ...(body.tool_choice ? { tool_choice: mapToolChoice(body.tool_choice) } : {}),
    };
  }

  async chat(args: AdapterArgs): Promise<AdapterResult> {
    const { provider, apiKey, signal, timeoutMs } = args;
    const res = await upstreamFetch(
      joinUrl(provider.baseUrl, 'messages'),
      {
        method: 'POST',
        headers: {
          ...(provider.headers && typeof provider.headers === 'object' ? provider.headers : {}),
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(this.payload(args)),
      },
      timeoutMs,
      signal,
    );
    if (!res.ok) {
      throw new UpstreamError(await readUpstreamError(res), res.status, isRetryableStatus(res.status));
    }
    const json: any = await res.json();
    const text = (json.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
    const toolCalls = (json.content || [])
      .filter((b: any) => b.type === 'tool_use')
      .map((b: any, index: number) => ({
        index,
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
      }));

    const promptTokens = Number(json.usage?.input_tokens || 0);
    const completionTokens = Number(json.usage?.output_tokens || 0);
    return {
      response: {
        id: json.id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: json.model || args.upstreamModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: text || null,
              ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
            },
            finish_reason: mapStopReason(json.stop_reason),
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      },
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      upstreamRequestId: json.id,
    };
  }

  async *chatStream(args: AdapterArgs): AsyncGenerator<StreamEvent> {
    const { provider, apiKey, signal, timeoutMs } = args;
    const res = await upstreamFetch(
      joinUrl(provider.baseUrl, 'messages'),
      {
        method: 'POST',
        headers: {
          ...(provider.headers && typeof provider.headers === 'object' ? provider.headers : {}),
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({ ...this.payload(args), stream: true }),
      },
      timeoutMs,
      signal,
    );
    if (!res.ok) {
      throw new UpstreamError(await readUpstreamError(res), res.status, isRetryableStatus(res.status));
    }

    let id = `chatcmpl-${Date.now()}`;
    let model = args.upstreamModel;
    let inputTokens = 0;
    let outputTokens = 0;
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

      if (json.type === 'message_start') {
        id = json.message?.id || id;
        model = json.message?.model || model;
        inputTokens = Number(json.message?.usage?.input_tokens || 0);
        if (!sentRole) {
          sentRole = true;
          yield {
            chunk: openAiChunk({ id, model, delta: { role: 'assistant' } }),
            upstreamRequestId: id,
          };
        }
        continue;
      }

      if (json.type === 'content_block_start') {
        const block = json.content_block;
        if (block?.type === 'tool_use') {
          yield {
            chunk: openAiChunk({
              id,
              model,
              delta: {
                tool_calls: [
                  {
                    index: json.index ?? 0,
                    id: block.id,
                    type: 'function',
                    function: { name: block.name, arguments: '' },
                  },
                ],
              },
            }),
            upstreamRequestId: id,
          };
        }
        continue;
      }

      if (json.type === 'content_block_delta') {
        const delta = json.delta;
        if (delta?.type === 'text_delta' && delta.text) {
          yield {
            chunk: openAiChunk({ id, model, delta: { content: delta.text } }),
            text: delta.text,
            upstreamRequestId: id,
          };
        } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
          yield {
            chunk: openAiChunk({
              id,
              model,
              delta: {
                tool_calls: [
                  {
                    index: json.index ?? 0,
                    function: { arguments: delta.partial_json },
                  },
                ],
              },
            }),
            upstreamRequestId: id,
          };
        }
        continue;
      }

      if (json.type === 'message_delta') {
        finishReason = mapStopReason(json.delta?.stop_reason);
        outputTokens = Number(json.usage?.output_tokens ?? outputTokens);
        continue;
      }

      if (json.type === 'message_stop') {
        break;
      }
    }

    yield {
      chunk: openAiChunk({
        id,
        model,
        delta: {},
        finishReason: finishReason || 'stop',
        usage: {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      }),
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason: finishReason || 'stop',
      upstreamRequestId: id,
    };
  }
}
