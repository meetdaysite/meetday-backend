import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { withRetry } from '../utils/retry';

@Injectable()
export class RedisHealthService implements OnModuleInit {
  private readonly logger = new Logger(RedisHealthService.name);

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const host = this.configService.get<string>('redis.host');
    const port = this.configService.get<number>('redis.port');

    const redis = new Redis({
      host,
      port,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 5000,
    });

    // Suppress ioredis's own error events during retry — we handle them ourselves
    redis.on('error', () => {});

    try {
      await withRetry(
        async () => {
          await redis.connect();
          await redis.ping();
        },
        { label: 'Redis', logger: this.logger },
      );
      this.logger.log(`Redis connected at ${host}:${port}`);
    } finally {
      await redis.quit();
    }
  }
}
