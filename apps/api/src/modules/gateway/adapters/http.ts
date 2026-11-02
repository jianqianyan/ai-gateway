import { UpstreamError } from '../upstream-error';

export async function upstreamFetch(
  url: string,
  init: RequestInit,
  timeoutMs = 120000,
  signal?: AbortSignal,
): Promise<Response> {
  let combined: AbortSignal;
  const timeout = AbortSignal.timeout(timeoutMs);
  if (signal) {
    combined = AbortSignal.any([signal, timeout]);
  } else {
    combined = timeout;
  }

  try {
    return await fetch(url, { ...init, signal: combined });
  } catch (e: any) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      if (signal?.aborted) {
        throw new UpstreamError('Client disconnected', 499, false);
      }
      throw new UpstreamError('Upstream request timed out', 504, true);
    }
    throw new UpstreamError(`Upstream connection failed: ${e.message}`, 502, true);
  }
}

export async function readUpstreamError(res: Response): Promise<string> {
  let detail = '';
  try {
    const text = await res.text();
    detail = text.slice(0, 800);
  } catch {
    // ignore
  }
  return `Upstream returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`;
}
