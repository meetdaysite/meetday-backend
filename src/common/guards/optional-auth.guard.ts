import * as crypto from 'crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as firebaseAdmin from 'firebase-admin';
import { PrismaService } from '../../prisma/prisma.service';
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

/**
 * Best-effort auth for public discovery routes. If a valid Bearer token is
 * present it verifies it and resolves the internal user id onto `request.user`;
 * if the token is absent or invalid the request proceeds anonymously. It never
 * rejects — logged-out browsing must still work.
 *
 * Apply alongside `@Public()` so the global FirebaseAuthGuard skips the route
 * and this guard owns the optional resolution.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return true;

    const token = authHeader.split(' ')[1];
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const cacheKey = `firebase:token:${tokenHash}`;

    let firebaseUser: CachedUser | null = await this.redis.get<CachedUser>(cacheKey);

    if (!firebaseUser) {
      try {
        const decoded = await firebaseAdmin.auth().verifyIdToken(token);
        firebaseUser = {
          uid: decoded.uid,
          email: decoded.email,
          phone: decoded.phone_number,
          displayName: decoded.name,
          avatarUrl: decoded.picture,
          provider: (decoded.firebase?.sign_in_provider ?? 'unknown') as string,
          emailVerified: decoded.email_verified ?? false,
        };
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) await this.redis.set(cacheKey, firebaseUser, ttl);
      } catch {
        return true; // invalid token → treat as anonymous, don't block
      }
    }

    // Resolve internal user id so @GetUser('id') works downstream.
    const dbUser = await this.prisma.user.findUnique({
      where: { firebaseUid: firebaseUser.uid },
      select: { id: true, isActive: true },
    });

    request.user = {
      ...firebaseUser,
      ...(dbUser?.isActive ? { id: dbUser.id } : {}),
    };

    return true;
  }
}
