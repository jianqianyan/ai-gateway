import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../core/redis.service';
import { logger } from '../../common/logger';

const LUA = `
local rpmLimit = tonumber(ARGV[1])
local dayLimit = tonumber(ARGV[2])
local concLimit = tonumber(ARGV[3])
local tpmLimit = tonumber(ARGV[4])
local estimatedTokens = tonumber(ARGV[5])

local rpmCount = 0
if rpmLimit > 0 then
  rpmCount = redis.call('INCR', KEYS[1])
  if rpmCount == 1 then redis.call('EXPIRE', KEYS[1], 120) end
  if rpmCount > rpmLimit then
    return {0, 'rpm', 0, rpmCount, 0, 0, 60}
  end
end

local dayCount = 0
if dayLimit > 0 then
  dayCount = redis.call('INCR', KEYS[2])
  if dayCount == 1 then redis.call('EXPIRE', KEYS[2], 172800) end
  if dayCount > dayLimit then
    return {0, 'daily', 0, rpmCount, dayCount, 0, 86400}
  end
end

if tpmLimit > 0 and estimatedTokens > 0 then
  local tpmCount = redis.call('INCRBY', KEYS[4], estimatedTokens)
  if tpmCount == estimatedTokens then redis.call('EXPIRE', KEYS[4], 120) end
  if tpmCount > tpmLimit then
    return {0, 'tpm', 0, rpmCount, dayCount, 0, 60}
  end
end

local concAcquired = 0
if concLimit > 0 then
  local conc = redis.call('INCR', KEYS[3])
  if conc == 1 then redis.call('EXPIRE', KEYS[3], 300) end
  if conc > concLimit then
    redis.call('DECR', KEYS[3])
    return {0, 'concurrency', 0, rpmCount, dayCount, 0, 1}
  end
  concAcquired = 1
end

return {1, 'ok', concAcquired, rpmCount, dayCount, 0, 0}
`;

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  concurrencyAcquired: boolean;
  retryAfter: number;
  headers: Record<string, string>;
}

@Injectable()
export class RateLimitService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async acquire(key: any, estimatedTokens = 0): Promise<RateLimitResult> {
    const rpmLimit = Number(key.rpmLimit || 0);
    const dailyLimit = Number(key.dailyRequestLimit || 0);
    const concLimit = Number(key.concurrencyLimit || 0);
    const tpmLimit = Number(key.tpmLimit || 0);

    if (!rpmLimit && !dailyLimit && !concLimit && !tpmLimit) {
      return { allowed: true, concurrencyAcquired: false, retryAfter: 0, headers: {} };
    }

    const minute = Math.floor(Date.now() / 60000);
    const day = this.dayKey();
    const prefix = `rl:${key.id}`;
    const keys = [
      `${prefix}:rpm:${minute}`,
      `${prefix}:day:${day}`,
      `${prefix}:conc`,
      `${prefix}:tpm:${minute}`,
    ];

    try {
      const raw = await this.redis
        .getClient()
        .eval(
          LUA,
          4,
          ...keys,
          String(rpmLimit),
          String(dailyLimit),
          String(concLimit),
          String(tpmLimit),
          String(Math.max(0, Math.floor(estimatedTokens))),
        );
      const result = raw as number[];
      const allowed = result[0] === 1;
      const reason = String(result[1] || '');
      const concurrencyAcquired = result[2] === 1;
      const rpmCount = Number(result[3] || 0);
      const retryAfter = Number(result[6] || 60);

      const headers: Record<string, string> = {};
      if (rpmLimit) {
        headers['x-ratelimit-limit-requests'] = String(rpmLimit);
        headers['x-ratelimit-remaining-requests'] = String(Math.max(0, rpmLimit - rpmCount));
        headers['x-ratelimit-reset-requests'] = new Date((minute + 1) * 60000).toISOString();
      }
      if (!allowed) {
        headers['retry-after'] = String(retryAfter);
      }

      return { allowed, reason, concurrencyAcquired, retryAfter, headers };
    } catch (e: any) {
      const failOpen = String(this.config.get('RATE_LIMIT_FAIL_OPEN') || 'true') === 'true';
      logger.warn({ err: e.message, keyId: key.id, failOpen }, 'redis rate limit unavailable');
      if (failOpen) {
        return {
          allowed: true,
          concurrencyAcquired: false,
          retryAfter: 0,
          headers: { 'x-ratelimit-degraded': '1' },
        };
      }
      return {
        allowed: false,
        reason: 'redis_unavailable',
        concurrencyAcquired: false,
        retryAfter: 5,
        headers: { 'retry-after': '5', 'x-ratelimit-degraded': '1' },
      };
    }
  }

  async releaseConcurrency(keyId: string, acquired: boolean) {
    if (!acquired) return;
    try {
      const client = this.redis.getClient();
      const value = await client.decr(`rl:${keyId}:conc`);
      if (value < 0) await client.set(`rl:${keyId}:conc`, 0);
    } catch {
      // slot will expire via TTL
    }
  }

  private dayKey() {
    const timeZone = this.config.get('APP_TIMEZONE') || 'Asia/Shanghai';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }
}
