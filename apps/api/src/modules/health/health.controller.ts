import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../core/prisma.service';
import { RedisService } from '../../core/redis.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async health(@Res({ passthrough: true }) res: Response) {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    const redis = await this.redis.ping();
    const ok = db && redis;
    res.status(ok ? 200 : 503);
    return {
      status: ok ? 'ok' : 'degraded',
      service: 'ai-gateway',
      db,
      redis,
      timestamp: new Date().toISOString(),
    };
  }
}
