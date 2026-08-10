import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';
import { OTP_PROVIDER } from './otp-provider.interface';
import { Fast2SmsOtpProvider } from './fast2sms-otp.provider';
import { LogOtpProvider } from './log-otp.provider';

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [
    Fast2SmsOtpProvider,
    LogOtpProvider,
    {
      provide: OTP_PROVIDER,
      // Real SMS delivery once FAST2SMS_API_KEY + FAST2SMS_OTP_TEMPLATE_ID are set; falls back to
      // logging the OTP server-side otherwise (local/dev only — never reaches a real phone).
      useFactory: (config: ConfigService, fast2sms: Fast2SmsOtpProvider, log: LogOtpProvider) =>
        config.get<string>('fast2sms.apiKey') && config.get<string>('fast2sms.otpTemplateId') ? fast2sms : log,
      inject: [ConfigService, Fast2SmsOtpProvider, LogOtpProvider],
    },
  ],
  exports: [OTP_PROVIDER],
})
export class OtpProviderModule {}
