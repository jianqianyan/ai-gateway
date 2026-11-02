export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AdapterArgs {
  provider: any;
  apiKey: string;
  upstreamModel: string;
  body: any;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AdapterResult {
  response: any;
  usage?: Usage;
  upstreamRequestId?: string;
}

export interface StreamEvent {
  chunk?: any;
  text?: string;
  usage?: Usage;
  finishReason?: string | null;
  upstreamRequestId?: string;
}

export interface UpstreamAdapter {
  chat(args: AdapterArgs): Promise<AdapterResult>;
  chatStream(args: AdapterArgs): AsyncGenerator<StreamEvent>;
}

export function extractOpenAiText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join('');
  }
  return '';
}

export function openAiChunk(options: {
  id?: string;
  model: string;
  created?: number;
  delta?: any;
  finishReason?: string | null;
  usage?: Usage;
}) {
  return {
    id: options.id || `chatcmpl-gw-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: options.created || Math.floor(Date.now() / 1000),
    model: options.model,
    choices: [
      {
        index: 0,
        delta: options.delta || {},
        finish_reason: options.finishReason ?? null,
      },
    ],
    ...(options.usage ? { usage: options.usage } : {}),
  };
}
