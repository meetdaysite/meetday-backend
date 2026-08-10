import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import * as firebaseAdmin from 'firebase-admin';
import { RedisService } from '../../common/redis/redis.service';
import { OTP_PROVIDER, type OtpProvider } from '../../common/otp/otp-provider.interface';

const RESEND_COOLDOWN_SECONDS = 45;

@Injectable()
export class PhoneOtpService {
  constructor(
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
    private readonly redis: RedisService,
  ) {}

  // Fast2SMS's OTP API takes a bare 10-digit Indian mobile number, not E.164.
  private toLocalMobile(e164Phone: string): string {
    return e164Phone.replace(/^\+91/, '');
  }

  private cooldownKey(phone: string): string {
    return `phone-otp-cooldown:${phone}`;
  }

  async sendOtp(phone: string): Promise<void> {
    if (await this.redis.exists(this.cooldownKey(phone))) {
      throw new BadRequestException('Please wait before requesting another OTP.');
    }
    await this.redis.set(this.cooldownKey(phone), '1', RESEND_COOLDOWN_SECONDS);
    await this.otpProvider.sendOtp(this.toLocalMobile(phone));
  }

  // On success, mints a Firebase custom token so the frontend can exchange it for a normal
  // Firebase session via signInWithCustomToken — everything downstream (ID token verification,
  // /auth/register, /auth/me, RolesGuard, etc.) stays exactly as it was.
  async verifyOtp(phone: string, otp: string): Promise<string> {
    const valid = await this.otpProvider.verifyOtp(this.toLocalMobile(phone), otp);
    if (!valid) throw new BadRequestException('Invalid or expired OTP.');

    let uid: string;
    try {
      const user = await firebaseAdmin.auth().getUserByPhoneNumber(phone);
      uid = user.uid;
    } catch {
      const created = await firebaseAdmin.auth().createUser({ phoneNumber: phone });
      uid = created.uid;
    }

    return firebaseAdmin.auth().createCustomToken(uid);
  }
}
