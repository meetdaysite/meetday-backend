import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Request, Response } from 'express';
import { ADMIN_ERROR_ALERT_EMAILS } from '../mail/admin-recipients.constant';

interface RequestUser {
  id?: string;
  uid?: string;
  email?: string;
  displayName?: string;
}

@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(@InjectQueue('mail') private readonly mailQueue: Queue) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    this.logger.error(
      `${request.method} ${request.url} → ${status}`,
      exception instanceof Error ? exception.stack : JSON.stringify(exception),
    );

    this.alertAdmins(request, status, exception);

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message:
        typeof message === 'object' && 'message' in (message as object)
          ? (message as { message: string }).message
          : message,
    });
  }

  // Genuine server errors (5xx — unhandled bugs, crashes) are emailed to admins with the
  // user's name/email. Routine 4xx responses (404/400/401/403/409 etc.) are expected app
  // control-flow, not bugs — alerting on those just spams admins' inboxes.
  private alertAdmins(request: Request, status: number, exception: unknown): void {
    if (status < 500) return;

    const user = (request as unknown as { user?: RequestUser }).user;
    const errorMessage =
      exception instanceof Error ? (exception.stack ?? exception.message) : JSON.stringify(exception);
    const context = `${request.method} ${request.url} (${status})`;
    const userLabel = user
      ? `${user.displayName || user.email || user.uid || 'Unknown user'} (${user.email || user.uid || 'unknown'})`
      : undefined;

    for (const to of ADMIN_ERROR_ALERT_EMAILS) {
      void this.mailQueue.add('error-alert', { to, context, message: errorMessage, userLabel }).catch(() => {});
    }
  }
}
