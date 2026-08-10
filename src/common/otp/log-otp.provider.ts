import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import type { OtpProvider } from './otp-provider.interface';

const OTP_TTL_SECONDS = 10 * 60; // 10 minutes, matches Fast2SMS's default expiry
const MAX_VERIFY_ATTEMPTS = 5;

interface StoredOtp {
  hash: string;
  attempts: number;
}

// Dev/local fallback used when no real SMS gateway is configured (FAST2SMS_API_KEY unset) —
// generates and stores the OTP ourselves in Redis and just logs it instead of sending a real SMS.
@Injectable()
export class LogOtpProvider implements OtpProvider {
  private readonly logger = new Logger(LogOtpProvider.name);

  constructor(private readonly redis: RedisService) {}

  private key(phone: string): string {
    return `phone-otp:${phone}`;
  }

  async sendOtp(phone: string): Promise<void> {
    const otp = crypto.randomInt(100000, 1000000).toString();
    const hash = crypto.createHash('sha256').update(otp).digest('hex');
    await this.redis.set(this.key(phone), { hash, attempts: 0 } satisfies StoredOtp, OTP_TTL_SECONDS);
    this.logger.warn(
      `[DEV ONLY — no SMS gateway configured] OTP for ${phone}: ${otp} (set FAST2SMS_API_KEY + FAST2SMS_OTP_TEMPLATE_ID for real SMS)`,
    );
  }

  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    const stored = await this.redis.get<StoredOtp>(this.key(phone));
    if (!stored) return false;
    if (stored.attempts >= MAX_VERIFY_ATTEMPTS) {
      await this.redis.del(this.key(phone));
      return false;
    }

    const hash = crypto.createHash('sha256').update(otp).digest('hex');
    if (hash !== stored.hash) {
      await this.redis.set(this.key(phone), { ...stored, attempts: stored.attempts + 1 }, OTP_TTL_SECONDS);
      return false;
    }

    await this.redis.del(this.key(phone));
    return true;
  }
}
