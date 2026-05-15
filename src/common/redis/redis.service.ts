import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { withRetry } from '../utils/retry';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.client = new Redis({
      host: this.configService.get<string>('redis.host'),
      port: this.configService.get<number>('redis.port'),
      lazyConnect: true,
      // Exponential backoff capped at 30s for reconnections (e.g. tunnel drops)
      retryStrategy: (times) => Math.min(1000 * 2 ** (times - 1), 30_000),
      maxRetriesPerRequest: null,
    });

    this.client.on('ready', () => this.logger.log('Redis connected'));
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));

    await withRetry(() => this.client.connect(), {
      label: 'Redis',
      logger: this.logger,
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
