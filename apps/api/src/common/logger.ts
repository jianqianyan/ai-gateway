import pino from 'pino';
import type { LoggerService } from '@nestjs/common';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'apiKey',
      'secret',
      'token',
    ],
    censor: '[REDACTED]',
  },
});

export class AppLogger implements LoggerService {
  log(message: any, context?: string) {
    logger.info({ context }, String(message));
  }
  error(message: any, stack?: string, context?: string) {
    logger.error({ context, stack }, String(message));
  }
  warn(message: any, context?: string) {
    logger.warn({ context }, String(message));
  }
  debug(message: any, context?: string) {
    logger.debug({ context }, String(message));
  }
  verbose(message: any, context?: string) {
    logger.trace({ context }, String(message));
  }
}
