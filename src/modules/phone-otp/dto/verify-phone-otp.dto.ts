import { IsString, Length, Matches } from 'class-validator';

export class VerifyPhoneOtpDto {
  @Matches(/^\+91[6-9]\d{9}$/, { message: 'phone must be a valid Indian number in E.164 format, e.g. +919876543210' })
  phone: string;

  @IsString()
  @Length(4, 10, { message: 'Invalid OTP' })
  otp: string;
}
