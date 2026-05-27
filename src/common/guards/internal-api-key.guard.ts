import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const key: string | undefined = req.headers['x-api-key'];
    const expected = this.config.get<string>('internalApiKey');

    if (!key || key !== expected) {
      throw new UnauthorizedException('Invalid or missing internal API key');
    }

    return true;
  }
}
