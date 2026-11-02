export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
    public readonly retryable = false,
    public readonly details?: any,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export function isRetryableStatus(status: number): boolean {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}
