import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from './errors';
import { logger } from './logger';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Internal server error';
    let type = 'server_error';
    let headers: Record<string, string> | undefined;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      type = exception.type;
      headers = exception.headers;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        message = Array.isArray(body.message)
          ? body.message.join('; ')
          : body.message || exception.message;
        code = body.code || code;
        type = body.type || (status === 401 ? 'authentication_error' : type);
      } else {
        message = exception.message;
      }
      if (status === 401) type = 'authentication_error';
      if (status === 403) type = 'permission_error';
      if (status === 429) type = 'rate_limit_error';
      if (code === 'internal_error') {
        const codes: Record<number, string> = {
          400: 'bad_request',
          401: 'unauthorized',
          403: 'forbidden',
          404: 'not_found',
          409: 'conflict',
          413: 'payload_too_large',
          429: 'rate_limit_exceeded',
        };
        code = codes[status] || code;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'duplicate_resource';
        message = 'Resource already exists';
        type = 'invalid_request_error';
      } else {
        message = 'Database error';
      }
    } else if (exception instanceof Error) {
      message = exception.message || message;
      logger.error({ err: exception, path: req.path }, 'unhandled exception');
    }

    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
      }
    }

    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }

    const requestId = req.requestId;
    const isGateway = req.path?.startsWith('/v1');

    if (isGateway) {
      res.status(status).json({
        error: {
          message,
          type,
          param: null,
          code,
        },
        request_id: requestId,
      });
      return;
    }

    res.status(status).json({
      statusCode: status,
      code,
      message,
      requestId,
    });
  }
}
