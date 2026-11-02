import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { logger } from '../common/logger';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;
  private connected = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    this.client.on('ready', () => {
      this.connected = true;
      logger.info('redis connected');
    });
    this.client.on('error', (err) => {
      this.connected = false;
      logger.warn({ err: err.message }, 'redis error');
    });
    this.client.on('close', () => {
      this.connected = false;
    });
    try {
      await this.client.connect();
    } catch (e: any) {
      logger.warn({ err: e.message }, 'redis initial connection failed; gateway will degrade');
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    }
  }

  getClient(): Redis {
    return this.client;
  }

  isConnected() {
    return this.connected;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
