import { Matches } from 'class-validator';

export class SendPhoneOtpDto {
  @Matches(/^\+91[6-9]\d{9}$/, { message: 'phone must be a valid Indian number in E.164 format, e.g. +919876543210' })
  phone: string;
}
