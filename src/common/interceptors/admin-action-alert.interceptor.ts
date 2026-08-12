import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { ADMIN_ALERT_EMAILS } from '../mail/admin-recipients.constant';

// High-frequency, low-value actions (chat messages, presence/typing, read-receipts) are
// excluded to avoid flooding admin inboxes and risking the sending domain's reputation.
// Real-time chat itself goes over the WebSocket gateway, not HTTP, so it never reaches here.
const EXCLUDED_PATH_SEGMENTS = ['/messages', '/presence', '/typing', '/read-receipt', '/heartbeat', '/health'];

interface RequestUser {
  id?: string;
  uid?: string;
  email?: string;
  displayName?: string;
}

// Emails the fixed admin-alert recipient list whenever an authenticated user successfully
// completes a mutating (non-GET) request, so admins have visibility into everything users do.
@Injectable()
export class AdminActionAlertInterceptor implements NestInterceptor {
  constructor(@InjectQueue('mail') private readonly mailQueue: Queue) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    if (this.shouldSkip(request)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const user = (request as unknown as { user?: RequestUser }).user;
        if (!user) return;

        const name = user.displayName || user.email || user.uid || 'Unknown user';
        const email = user.email || user.uid || 'unknown';
        const userLabel = `${name} (${email})`;
        const path = request.originalUrl || request.url;

        for (const to of ADMIN_ALERT_EMAILS) {
          void this.mailQueue
            .add('user-action', { to, userLabel, method: request.method, path })
            .catch(() => {});
        }
      }),
    );
  }

  private shouldSkip(request: Request): boolean {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return true;
    const path = (request.originalUrl || request.url || '').toLowerCase();
    return EXCLUDED_PATH_SEGMENTS.some((segment) => path.includes(segment));
  }
}
