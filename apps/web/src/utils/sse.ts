export interface StreamCallbacks {
  onMeta?: (meta: { requestId?: string | null }) => void;
  onDelta?: (text: string) => void;
  onFinish?: (reason: string | null) => void;
  onUsage?: (usage: any) => void;
  onError?: (message: string, code?: string) => void;
}

export async function streamChat(
  url: string,
  token: string,
  body: any,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  callbacks.onMeta?.({ requestId: response.headers.get('x-gateway-request-id') });

  const contentType = response.headers.get('content-type') || '';
  if (response.ok && !contentType.includes('text/event-stream')) {
    try {
      const data: any = await response.json();
      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content === 'string' && content) callbacks.onDelta?.(content);
      if (data?.usage) callbacks.onUsage?.(data.usage);
      if (choice?.finish_reason) callbacks.onFinish?.(choice.finish_reason);
      return;
    } catch {
      callbacks.onError?.('响应解析失败');
      return;
    }
  }

  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    let code;
    try {
      const data = await response.json();
      message = data?.error?.message || data?.message || message;
      code = data?.error?.code || data?.code;
    } catch {
      // ignore
    }
    callbacks.onError?.(message, code);
    return;
  }

  if (!response.body) {
    callbacks.onError?.('浏览器不支持流式响应');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  const processBlock = (block: string) => {
    const lines = block.split('\n');
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const data = dataLines.join('\n');
    if (data === '[DONE]') {
      finished = true;
      return;
    }
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (json?.error) {
      callbacks.onError?.(json.error.message || '模型调用失败', json.error.code);
      finished = true;
      return;
    }
    if (json?.usage) callbacks.onUsage?.(json.usage);
    const choice = json?.choices?.[0];
    if (choice?.delta?.content) callbacks.onDelta?.(choice.delta.content);
    if (choice?.finish_reason) callbacks.onFinish?.(choice.finish_reason);
  };

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let idx = buffer.indexOf('\n\n');
      while (idx >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        processBlock(block);
        idx = buffer.indexOf('\n\n');
        if (finished) break;
      }
    }
    if (!finished && buffer.trim()) processBlock(buffer);
  } finally {
    reader.releaseLock();
  }
}
