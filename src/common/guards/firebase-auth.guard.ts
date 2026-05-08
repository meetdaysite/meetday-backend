import * as crypto from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as firebaseAdmin from 'firebase-admin';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RedisService } from '../redis/redis.service';

interface CachedUser {
  uid: string;
  email?: string;
  phone?: string;
  displayName?: string;
  avatarUrl?: string;
  provider: string;
  emailVerified: boolean;
}

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed authorization header');
    }

    const token = authHeader.split(' ')[1];
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const cacheKey = `firebase:token:${tokenHash}`;

    const cached = await this.redis.get<CachedUser>(cacheKey);
    if (cached) {
      request.user = cached;
      return true;
    }

    try {
      const decoded = await firebaseAdmin.auth().verifyIdToken(token);
      const provider = (decoded.firebase?.sign_in_provider ?? 'unknown') as string;

      const user: CachedUser = {
        uid: decoded.uid,
        email: decoded.email,
        phone: decoded.phone_number,
        displayName: decoded.name,
        avatarUrl: decoded.picture,
        provider,
        emailVerified: decoded.email_verified ?? false,
      };

      request.user = user;

      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.redis.set(cacheKey, user, ttl);
      }

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
