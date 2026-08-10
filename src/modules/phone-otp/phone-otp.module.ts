import { Module } from '@nestjs/common';
import { OtpProviderModule } from '../../common/otp/otp-provider.module';
import { PhoneOtpController } from './phone-otp.controller';
import { PhoneOtpService } from './phone-otp.service';

@Module({
  imports: [OtpProviderModule],
  controllers: [PhoneOtpController],
  providers: [PhoneOtpService],
})
export class PhoneOtpModule {}
