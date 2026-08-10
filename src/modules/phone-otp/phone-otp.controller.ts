import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PhoneOtpService } from './phone-otp.service';
import { SendPhoneOtpDto } from './dto/send-phone-otp.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Auth')
@Controller('auth/phone-otp')
export class PhoneOtpController {
  constructor(private readonly phoneOtpService: PhoneOtpService) {}

  @Public()
  @Post('send')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a phone verification OTP',
    description:
      'Sends a 6-digit OTP via our own SMS gateway (not Firebase\'s built-in phone-auth). ' +
      'Call POST /auth/phone-otp/verify next, then signInWithCustomToken() on the client with the returned token.',
  })
  async send(@Body() dto: SendPhoneOtpDto): Promise<{ message: string }> {
    await this.phoneOtpService.sendOtp(dto.phone);
    return { message: 'OTP sent' };
  }

  @Public()
  @Post('verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a phone OTP and receive a Firebase custom token',
    description:
      'On success, returns a Firebase custom token — exchange it client-side via signInWithCustomToken() ' +
      'to get a normal Firebase session (ID token, etc.) for the rest of the app.',
  })
  async verify(@Body() dto: VerifyPhoneOtpDto): Promise<{ customToken: string }> {
    const customToken = await this.phoneOtpService.verifyOtp(dto.phone, dto.otp);
    return { customToken };
  }
}
