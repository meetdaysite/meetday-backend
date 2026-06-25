import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../redis/redis.service';

const PUB_LIMIT = 60;   // unauthenticated requests per minute per IP
const AUTH_LIMIT = 600;  // authenticated requests per minute per IP
const AUTO_BLOCK_MULTIPLIER = 3; // auto-block when count exceeds limit × this
const AUTO_BLOCK_TTL_S = 900;    // 15 minutes

@Injectable()
export class IpRateLimitMiddleware implements NestMiddleware {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    if (!this.config.get<boolean>('rateLimitEnabled')) return next();

    const ip = this.extractIp(req);
    const whitelist = this.config.get<string[]>('ipWhitelist') ?? [];
    if (whitelist.includes(ip)) return next();

    if (await this.redis.exists(`ip_blocked:${ip}`)) {
      res.status(403).json({ statusCode: 403, message: 'IP temporarily blocked. Try again later.' });
      return;
    }

    const isAuthed = !!req.headers['authorization'];
    const limit = isAuthed ? AUTH_LIMIT : PUB_LIMIT;
    const windowKey = `ip_rl:${isAuthed ? 'auth' : 'pub'}:${ip}:${Math.floor(Date.now() / 60_000)}`;

    const count = await this.redis.incr(windowKey);
    if (count === 1) await this.redis.expire(windowKey, 120);

    if (count > limit * AUTO_BLOCK_MULTIPLIER) {
      await this.redis.set(`ip_blocked:${ip}`, '1', AUTO_BLOCK_TTL_S);
      res.status(429).set('Retry-After', String(AUTO_BLOCK_TTL_S)).json({
        statusCode: 429,
        message: 'Too many requests. IP blocked for 15 minutes.',
      });
      return;
    }

    if (count > limit) {
      res.status(429).set('Retry-After', '60').json({
        statusCode: 429,
        message: 'Too many requests. Please slow down.',
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
