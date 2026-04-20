import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface SandboxAuthResponse {
  access_token: string;
  transaction_id: string;
}

@Injectable()
export class SandboxAuthService {
  private readonly logger = new Logger(SandboxAuthService.name);

  readonly host: string;
  readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.host = this.configService.get<string>('sandbox.host')!;
    this.apiKey = this.configService.get<string>('sandbox.apiKey')!;
    this.apiSecret = this.configService.get<string>('sandbox.apiSecret')!;
  }

  // TODO: cache token with TTL to avoid a round-trip on every call
  async getToken(): Promise<string> {
    const res = await fetch(`${this.host}/authenticate`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'x-api-secret': this.apiSecret,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      this.logger.error(`Sandbox authentication failed — HTTP ${res.status}`);
      throw new InternalServerErrorException('KYC service authentication failed');
    }

    const body = (await res.json()) as SandboxAuthResponse;
    this.logger.debug(`Sandbox auth response: transaction_id=${body.transaction_id}`);
    return body.access_token;
  }
}
