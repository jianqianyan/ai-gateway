import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { json, urlencoded } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { AppLogger, logger } from './common/logger';

(BigInt.prototype as any).toJSON = function toJSON() {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });

  app.useLogger(new AppLogger());

  const maxBody = Number(process.env.MAX_BODY_BYTES || 10 * 1024 * 1024);
  app.use(json({ limit: maxBody }));
  app.use(urlencoded({ extended: true, limit: maxBody }));
  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );

  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy && trustProxy !== '0' && trustProxy !== 'false') {
    const hops = Number(trustProxy);
    (app as any).set('trust proxy', Number.isFinite(hops) ? hops : trustProxy);
  }

  const origins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
      if (!origin || isLocal || origins.length === 0 || origins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS origin not allowed'));
    },
    credentials: true,
  });

  app.use((req: any, res: any, next: () => void) => {
    const incoming = String(req.headers['x-request-id'] || '');
    req.requestId = /^[A-Za-z0-9_-]{8,100}$/.test(incoming)
      ? incoming
      : `req_${randomUUID()}`;
    res.setHeader('x-gateway-request-id', req.requestId);
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableShutdownHooks();

  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  logger.info({ port }, 'AI Gateway API started');
}

bootstrap().catch((err) => {
  Logger.error(err);
  logger.error({ err }, 'failed to start API');
  process.exit(1);
});
