import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as firebaseAdmin from 'firebase-admin';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

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

    try {
      const decoded = await firebaseAdmin.auth().verifyIdToken(token);

      // Normalise the provider so downstream code can branch on it
      const provider = (decoded.firebase?.sign_in_provider ?? 'unknown') as string;

      request.user = {
        uid: decoded.uid,
        // Identity fields — may be undefined depending on provider
        email: decoded.email,                     // present: email/password, Google, Apple
        phone: decoded.phone_number,              // present: phone auth
        displayName: decoded.name,                // present: Google, Apple
        avatarUrl: decoded.picture,               // present: Google, Apple
        provider,                                 // 'password' | 'phone' | 'google.com' | 'apple.com'
        emailVerified: decoded.email_verified ?? false,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
