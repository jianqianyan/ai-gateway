import { HttpException, HttpStatus } from '@nestjs/common';

export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: number = HttpStatus.BAD_REQUEST,
    public readonly type = 'invalid_request_error',
    public readonly headers?: Record<string, string>,
    public readonly details?: unknown,
  ) {
    super({ code, message, type, details }, status);
  }
}

export class GatewayError extends AppError {
  constructor(
    code: string,
    message: string,
    status = 400,
    type = 'invalid_request_error',
    headers?: Record<string, string>,
  ) {
    super(code, message, status, type, headers);
  }
}
