// Provider owns the whole OTP lifecycle (generate, deliver, verify) so a real gateway
// (e.g. Fast2SMS) can manage state on its own servers instead of duplicating it here.
export interface OtpProvider {
  // phone is a 10-digit Indian mobile number (no country code, no leading zero/plus).
  sendOtp(phone: string): Promise<void>;
  verifyOtp(phone: string, otp: string): Promise<boolean>;
}

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');
