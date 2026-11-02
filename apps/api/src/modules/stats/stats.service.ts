import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(range = '24h') {
    const since = this.since(range);
    const rows: any[] = await this.prisma.$queryRaw`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END), 0) AS success,
        COALESCE(SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END), 0) AS errors,
        COALESCE(SUM(CASE WHEN status = 'BLOCKED' THEN 1 ELSE 0 END), 0) AS blocked,
        COALESCE(SUM(CASE WHEN intercepted = 1 THEN 1 ELSE 0 END), 0) AS intercepted,
        COALESCE(SUM(totalTokens), 0) AS tokens,
        COALESCE(AVG(latencyMs), 0) AS avgLatency,
        COALESCE(MAX(latencyMs), 0) AS maxLatency,
        COALESCE(AVG(ttftMs), 0) AS avgTtft,
        COALESCE(SUM(costEstimate), 0) AS cost,
        COUNT(DISTINCT keyId) AS activeKeys
      FROM \`RequestLog\`
      WHERE createdAt >= ${since}
    `;
    const p95Rows: any[] = await this.prisma.$queryRaw`
      SELECT latencyMs FROM (
        SELECT latencyMs, PERCENT_RANK() OVER (ORDER BY latencyMs) AS pr
        FROM \`RequestLog\`
        WHERE createdAt >= ${since} AND status = 'SUCCESS'
      ) t
      WHERE pr >= 0.95
      ORDER BY latencyMs ASC
      LIMIT 1
    `;
    const r: any = rows[0] || {};
    const total = Number(r.total || 0);
    const success = Number(r.success || 0);
    return {
      range,
      requests: total,
      success,
      errors: Number(r.errors || 0),
      blocked: Number(r.blocked || 0),
      successRate: total ? Number(((success / total) * 100).toFixed(2)) : 0,
      tokens: Number(r.tokens || 0),
      avgLatencyMs: Math.round(Number(r.avgLatency || 0)),
      p95LatencyMs: Number(p95Rows[0]?.latencyMs || r.maxLatency || 0),
      avgTtftMs: Math.round(Number(r.avgTtft || 0)),
      cost: Number(r.cost || 0),
      intercepted: Number(r.intercepted || 0),
      activeKeys: Number(r.activeKeys || 0),
    };
  }

  async timeseries(range = '24h') {
    const since = this.since(range);
    const byDay = range === '7d' || range === '30d';
    const format = byDay ? '%Y-%m-%d' : '%Y-%m-%d %H:00';
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT DATE_FORMAT(createdAt, '${format}') AS bucket,
              COUNT(*) AS requests,
              COALESCE(SUM(totalTokens), 0) AS tokens,
              COALESCE(SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END), 0) AS errors,
              COALESCE(SUM(CASE WHEN intercepted = 1 THEN 1 ELSE 0 END), 0) AS intercepted
       FROM \`RequestLog\`
       WHERE createdAt >= ?
       GROUP BY bucket
       ORDER BY bucket ASC`,
      since,
    );
    return rows.map((r) => ({
      bucket: r.bucket,
      requests: Number(r.requests || 0),
      tokens: Number(r.tokens || 0),
      errors: Number(r.errors || 0),
      intercepted: Number(r.intercepted || 0),
    }));
  }

  async top(range = '24h') {
    const since = this.since(range);
    const models: any[] = await this.prisma.$queryRaw`
      SELECT modelRequested AS name, COUNT(*) AS requests, COALESCE(SUM(totalTokens), 0) AS tokens
      FROM \`RequestLog\` WHERE createdAt >= ${since}
      GROUP BY modelRequested ORDER BY requests DESC LIMIT 8
    `;
    const keys: any[] = await this.prisma.$queryRaw`
      SELECT COALESCE(keyName, '未知') AS name, COUNT(*) AS requests, COALESCE(SUM(totalTokens), 0) AS tokens
      FROM \`RequestLog\` WHERE createdAt >= ${since}
      GROUP BY keyName ORDER BY requests DESC LIMIT 8
    `;
    const providers: any[] = await this.prisma.$queryRaw`
      SELECT COALESCE(providerName, '未路由') AS name, COUNT(*) AS requests,
             COALESCE(AVG(latencyMs), 0) AS avgLatency
      FROM \`RequestLog\` WHERE createdAt >= ${since}
      GROUP BY providerName ORDER BY requests DESC LIMIT 8
    `;
    const errors: any[] = await this.prisma.$queryRaw`
      SELECT COALESCE(errorCode, 'unknown') AS code, COUNT(*) AS count
      FROM \`RequestLog\` WHERE createdAt >= ${since} AND status = 'ERROR'
      GROUP BY errorCode ORDER BY count DESC LIMIT 8
    `;
    return {
      models: models.map((r) => ({ ...r, requests: Number(r.requests), tokens: Number(r.tokens) })),
      keys: keys.map((r) => ({ ...r, requests: Number(r.requests), tokens: Number(r.tokens) })),
      providers: providers.map((r) => ({
        ...r,
        requests: Number(r.requests),
        avgLatency: Math.round(Number(r.avgLatency)),
      })),
      errors: errors.map((r) => ({ ...r, count: Number(r.count) })),
    };
  }

  async recent() {
    const items = await this.prisma.requestLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 12,
    });
    return items.map((l) => ({
      id: l.id.toString(),
      requestId: l.requestId,
      keyName: l.keyName,
      modelRequested: l.modelRequested,
      providerName: l.providerName,
      status: l.status,
      httpStatus: l.httpStatus,
      latencyMs: l.latencyMs,
      totalTokens: l.totalTokens,
      intercepted: l.intercepted,
      createdAt: l.createdAt,
    }));
  }

  private since(range: string) {
    const map: Record<string, number> = {
      '1h': 3600 * 1000,
      '24h': 24 * 3600 * 1000,
      '7d': 7 * 24 * 3600 * 1000,
      '30d': 30 * 24 * 3600 * 1000,
    };
    return new Date(Date.now() - (map[range] || map['24h']));
  }
}
