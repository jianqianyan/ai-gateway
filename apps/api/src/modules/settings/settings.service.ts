import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/prisma.service';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  defaults() {
    return {
      siteName: this.config.get('APP_NAME') || 'AI Gateway',
      logRetentionDays: Number(this.config.get('LOG_RETENTION_DAYS') || 30),
      bodyRetentionDays: Number(this.config.get('BODY_RETENTION_DAYS') || 7),
      requestTimeoutMs: Number(this.config.get('UPSTREAM_TIMEOUT_MS') || 120000),
      maxBodyBytes: Number(this.config.get('MAX_BODY_BYTES') || 10485760),
      trustProxy: this.config.get('TRUST_PROXY') || '1',
      rateLimitFailOpen: String(this.config.get('RATE_LIMIT_FAIL_OPEN') || 'true') === 'true',
      captureBodiesDefault: false,
      allowPrivateUpstreams: String(this.config.get('ALLOW_PRIVATE_UPSTREAMS') || 'false') === 'true',
      timezone: this.config.get('APP_TIMEZONE') || 'Asia/Shanghai',
    };
  }

  async getAll() {
    const rows = await this.prisma.setting.findMany();
    const stored: Record<string, any> = {};
    for (const row of rows) stored[row.key] = row.value;
    return { ...this.defaults(), ...stored };
  }

  async get<T = any>(key: string): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (row) return row.value as T;
    return (this.defaults() as any)[key];
  }

  async update(values: Record<string, any>) {
    const allowed = Object.keys(this.defaults());
    const entries = Object.entries(values || {}).filter(([k]) => allowed.includes(k));
    for (const [key, value] of entries) {
      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value: value as any },
        update: { value: value as any },
      });
    }
    return this.getAll();
  }
}
