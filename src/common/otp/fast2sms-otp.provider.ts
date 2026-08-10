import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpProvider } from './otp-provider.interface';

interface Fast2SmsSendResponse {
  return: boolean;
  status_code: number;
  request_id?: string;
  message: string;
}

interface Fast2SmsVerifyResponse {
  return: boolean;
  status_code: number;
  message: string;
}

// Real production integration — Fast2SMS's OTP API generates, stores and verifies the OTP
// on its own servers (DLT-compliant delivery for Indian numbers); we never see the raw code.
// Docs: https://docs.fast2sms.com/reference/send-otp , https://docs.fast2sms.com/reference/verify-otp
@Injectable()
export class Fast2SmsOtpProvider implements OtpProvider {
  private readonly logger = new Logger(Fast2SmsOtpProvider.name);
  private readonly apiKey: string;
  private readonly otpTemplateId: string;
  private static readonly BASE_URL = 'https://www.fast2sms.com/dev/otp';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('fast2sms.apiKey')!;
    this.otpTemplateId = this.config.get<string>('fast2sms.otpTemplateId')!;
  }

  async sendOtp(phone: string): Promise<void> {
    const res = await fetch(`${Fast2SmsOtpProvider.BASE_URL}/send`, {
      method: 'POST',
      headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: phone, otp_id: this.otpTemplateId }),
    });
    const body = (await res.json()) as Fast2SmsSendResponse;
    if (!res.ok || !body.return) {
      this.logger.error(`Fast2SMS send failed for ${phone}: ${body.message ?? res.statusText}`);
      throw new InternalServerErrorException('Failed to send OTP. Please try again in a moment.');
    }
  }

  async verifyOtp(phone: string, otp: string): Promise<boolean> {
    const res = await fetch(`${Fast2SmsOtpProvider.BASE_URL}/verify`, {
      method: 'POST',
      headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: phone, otp }),
    });
    const body = (await res.json()) as Fast2SmsVerifyResponse;
    return res.ok && body.return === true;
  }
}
