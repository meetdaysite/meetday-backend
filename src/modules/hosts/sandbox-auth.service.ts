import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface SandboxAuthResponse {
  access_token: string;
  transaction_id: string;
}

export interface SandboxTestFixtureMiss {
  transactionId: string;
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

  /**
   * Sandbox's TEST-environment quirk: an unrecognized PAN/bank-account input
   * (not one of its pre-registered fixtures) returns HTTP 404 with a body like
   * { message: "Test environment: Request does not match any saved example...",
   *   transaction_id: "..." } — a business-level "not verified" outcome, not
   * an infra failure. Matches by body shape only (not by host), since
   * SANDBOX_HOST is configurable and this must not gate on environment.
   * Any 404 that doesn't match this exact shape is still a genuine error.
   */
  static matchSandboxTestFixtureMiss(status: number, rawBody: string): SandboxTestFixtureMiss | null {
    if (status !== 404) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { message, transaction_id } = parsed as Record<string, unknown>;
    if (typeof message !== 'string' || !message.includes('does not match any saved example')) return null;
    if (typeof transaction_id !== 'string' || transaction_id.length === 0) return null;
    return { transactionId: transaction_id };
  }
}
