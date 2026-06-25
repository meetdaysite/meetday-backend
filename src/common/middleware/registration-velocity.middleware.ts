import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../redis/redis.service';

const MAX_REGISTRATIONS_PER_HOUR = 3;
const WINDOW_S = 3600;

@Injectable()
export class RegistrationVelocityMiddleware implements NestMiddleware {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    if (!this.config.get<boolean>('rateLimitEnabled')) return next();

    const ip = this.extractIp(req);
    const whitelist = this.config.get<string[]>('ipWhitelist') ?? [];
    if (whitelist.includes(ip)) return next();

    const key = `reg_velocity:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, WINDOW_S);

    if (count > MAX_REGISTRATIONS_PER_HOUR) {
      await this.redis.set(`ip_blocked:${ip}`, '1', WINDOW_S);
      res.status(429).json({
        statusCode: 429,
        message: 'Too many registrations from this IP. Please try again later.',
      });
      return;
    }

    next();
  }

  private extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
    return (raw ?? req.socket?.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
  }
}
