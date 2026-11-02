import { ProviderType } from '@prisma/client';
import { AdapterArgs, AdapterResult, StreamEvent, UpstreamAdapter, extractOpenAiText } from '../types';
import { UpstreamError, isRetryableStatus } from '../upstream-error';
import { upstreamFetch, readUpstreamError } from './http';
import { parseSse } from './sse';

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function buildUrl(provider: any, upstreamModel: string, stream: boolean) {
  if (provider.type === ProviderType.AZURE_OPENAI) {
    const headers = provider.headers && typeof provider.headers === 'object' ? provider.headers : {};
    const apiVersion = headers['api-version'] || headers['apiVersion'];
    const base = `${provider.baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(upstreamModel)}/chat/completions`;
    if (apiVersion) return `${base}?api-version=${encodeURIComponent(String(apiVersion))}`;
    return base;
  }
  return joinUrl(provider.baseUrl, 'chat/completions');
}

export class OpenAiAdapter implements UpstreamAdapter {
  async chat(args: AdapterArgs): Promise<AdapterResult> {
    const { provider, upstreamModel, body, apiKey, signal, timeoutMs } = args;
    const payload = {
      ...body,
      model: upstreamModel,
      stream: false,
    };
    delete payload.stream_options;

    const res = await upstreamFetch(
      buildUrl(provider, upstreamModel, false),
      {
        method: 'POST',
        headers: {
          ...(provider.headers && typeof provider.headers === 'object' ? provider.headers : {}),
          ...(provider.type === ProviderType.AZURE_OPENAI
            ? { 'api-key': apiKey }
            : { authorization: `Bearer ${apiKey}` }),
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
      signal,
    );

    if (!res.ok) {
      throw new UpstreamError(await readUpstreamError(res), res.status, isRetryableStatus(res.status));
    }
    const json: any = await res.json();
    return {
      response: json,
      usage: json?.usage
        ? {
            promptTokens: Number(json.usage.prompt_tokens || 0),
            completionTokens: Number(json.usage.completion_tokens || 0),
            totalTokens: Number(json.usage.total_tokens || 0),
          }
        : undefined,
      upstreamRequestId: json?.id || res.headers.get('x-request-id') || undefined,
    };
  }

  async *chatStream(args: AdapterArgs): AsyncGenerator<StreamEvent> {
    const { provider, upstreamModel, body, apiKey, signal, timeoutMs } = args;
    const payload = {
      ...body,
      model: upstreamModel,
      stream: true,
      stream_options: { include_usage: true },
    };

    const res = await upstreamFetch(
      buildUrl(provider, upstreamModel, true),
      {
        method: 'POST',
        headers: {
          ...(provider.headers && typeof provider.headers === 'object' ? provider.headers : {}),
          ...(provider.type === ProviderType.AZURE_OPENAI
            ? { 'api-key': apiKey }
            : { authorization: `Bearer ${apiKey}` }),
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
      signal,
    );

    if (!res.ok) {
      throw new UpstreamError(await readUpstreamError(res), res.status, isRetryableStatus(res.status));
    }

    const upstreamRequestId = res.headers.get('x-request-id') || undefined;
    for await (const event of parseSse(res.body)) {
      if (event.data === '[DONE]') return;
      let chunk: any;
      try {
        chunk = JSON.parse(event.data);
      } catch {
        continue;
      }
      const choice = chunk?.choices?.[0];
      const delta = choice?.delta;
      const text = extractOpenAiText(delta?.content);
      const usage = chunk?.usage
        ? {
            promptTokens: Number(chunk.usage.prompt_tokens || 0),
            completionTokens: Number(chunk.usage.completion_tokens || 0),
            totalTokens: Number(chunk.usage.total_tokens || 0),
          }
        : undefined;
      yield {
        chunk,
        text: text || undefined,
        usage,
        finishReason: choice?.finish_reason ?? undefined,
        upstreamRequestId: chunk?.id || upstreamRequestId,
      };
    }
  }
}
