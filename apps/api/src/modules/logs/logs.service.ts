import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RequestStatus } from '@prisma/client';
import { PrismaService } from '../../core/prisma.service';
import { AppError } from '../../common/errors';
import { logger } from '../../common/logger';
import { truncateJson } from '../../common/utils/redact';

export interface LogQuery {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  keyId?: string;
  model?: string;
  providerId?: string;
  status?: string;
  stream?: string;
  intercepted?: string;
  requestId?: string;
  clientIp?: string;
}

@Injectable()
export class LogsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.cleanup().catch((e) => logger.warn({ err: e.message }, 'log cleanup failed'));
    }, 6 * 3600 * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async createLog(data: any) {
    try {
      return await this.prisma.requestLog.create({ data });
    } catch (e: any) {
      logger.error({ err: e.message, requestId: data?.requestId }, 'failed to write request log');
      return null;
    }
  }

  async createBody(logId: bigint, requestBody: any, responseBody: any) {
    try {
      const days = Number(this.config.get('BODY_RETENTION_DAYS') || 7);
      await this.prisma.requestLogBody.create({
        data: {
          logId,
          requestBody: truncateJson(requestBody),
          responseBody: truncateJson(responseBody),
          redacted: true,
          expiresAt: new Date(Date.now() + days * 24 * 3600 * 1000),
        },
      });
    } catch (e: any) {
      logger.warn({ err: e.message, logId: logId.toString() }, 'failed to write request body');
    }
  }

  async list(query: LogQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const where = this.buildWhere(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.requestLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.requestLog.count({ where }),
    ]);
    return { items: items.map((l) => this.safe(l)), total, page, pageSize };
  }

  async detail(id: string) {
    let logId: bigint;
    try {
      logId = BigInt(id);
    } catch {
      throw new AppError('log_not_found', 'Log not found', 404);
    }
    const log = await this.prisma.requestLog.findUnique({ where: { id: logId } });
    if (!log) throw new AppError('log_not_found', 'Log not found', 404);
    const body = await this.prisma.requestLogBody.findUnique({ where: { logId } });
    return {
      ...this.safe(log),
      body: body
        ? {
            requestBody: body.requestBody,
            responseBody: body.responseBody,
            redacted: body.redacted,
            expiresAt: body.expiresAt,
          }
        : null,
    };
  }

  async exportRows(query: LogQuery) {
    const where = this.buildWhere(query);
    const items = await this.prisma.requestLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });
    return items.map((l) => this.safe(l));
  }

  async cleanup() {
    const logDays = Number(this.config.get('LOG_RETENTION_DAYS') || 30);
    const cutoff = new Date(Date.now() - logDays * 24 * 3600 * 1000);
    const deletedBodies = await this.prisma.requestLogBody.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const oldLogs = await this.prisma.requestLog.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: 5000,
    });
    let deletedLogs = 0;
    if (oldLogs.length) {
      await this.prisma.requestLogBody.deleteMany({
        where: { logId: { in: oldLogs.map((l) => l.id) } },
      });
      const result = await this.prisma.requestLog.deleteMany({
        where: { id: { in: oldLogs.map((l) => l.id) } },
      });
      deletedLogs = result.count;
    }
    if (deletedBodies.count || deletedLogs) {
      logger.info({ deletedBodies: deletedBodies.count, deletedLogs }, 'log retention cleanup');
    }
  }

  private buildWhere(query: LogQuery): Prisma.RequestLogWhereInput {
    const where: Prisma.RequestLogWhereInput = {};
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    if (query.keyId) where.keyId = query.keyId;
    if (query.model) where.modelRequested = { contains: query.model };
    if (query.providerId) where.providerId = query.providerId;
    if (query.status && Object.values(RequestStatus).includes(query.status as RequestStatus)) {
      where.status = query.status as RequestStatus;
    }
    if (query.stream === 'true' || query.stream === 'false') where.stream = query.stream === 'true';
    if (query.intercepted === 'true' || query.intercepted === 'false') {
      where.intercepted = query.intercepted === 'true';
    }
    if (query.requestId) where.requestId = { contains: query.requestId };
    if (query.clientIp) where.clientIp = { contains: query.clientIp };
    return where;
  }

  private safe(log: any) {
    return {
      id: log.id.toString(),
      requestId: log.requestId,
      keyId: log.keyId,
      keyName: log.keyName,
      modelRequested: log.modelRequested,
      providerId: log.providerId,
      providerName: log.providerName,
      upstreamModel: log.upstreamModel,
      endpoint: log.endpoint,
      stream: log.stream,
      status: log.status,
      httpStatus: log.httpStatus,
      errorCode: log.errorCode,
      errorMessage: log.errorMessage,
      latencyMs: log.latencyMs,
      ttftMs: log.ttftMs,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      totalTokens: log.totalTokens,
      usageEstimated: log.usageEstimated,
      costEstimate: log.costEstimate === null || log.costEstimate === undefined ? null : Number(log.costEstimate),
      clientIp: log.clientIp,
      userAgent: log.userAgent,
      requestBytes: log.requestBytes,
      responseBytes: log.responseBytes,
      retryCount: log.retryCount,
      attempts: log.attempts || [],
      intercepted: log.intercepted,
      interceptDirection: log.interceptDirection,
      interceptAction: log.interceptAction,
      interceptRuleIds: log.interceptRuleIds || [],
      interceptSummary: log.interceptSummary,
      upstreamRequestId: log.upstreamRequestId,
      traceId: log.traceId,
      source: log.source,
      createdAt: log.createdAt,
    };
  }
}
