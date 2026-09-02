import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  FIREBASE_PROJECT_ID: z.string().min(1, 'FIREBASE_PROJECT_ID is required'),
  FIREBASE_CLIENT_EMAIL: z.string().email('FIREBASE_CLIENT_EMAIL must be a valid email'),
  FIREBASE_PRIVATE_KEY: z.string().min(1, 'FIREBASE_PRIVATE_KEY is required'),

  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  MAIL_FROM: z.string().email('MAIL_FROM must be a valid email'),

  RAZORPAY_KEY_ID: z.string().min(1, 'RAZORPAY_KEY_ID is required'),
  RAZORPAY_KEY_SECRET: z.string().min(1, 'RAZORPAY_KEY_SECRET is required'),

  // Custom phone-OTP delivery (bypasses Firebase's own phone-auth SMS, unreliable for Indian
  // numbers without DLT registration). Omit both to fall back to logging the OTP server-side
  // (dev only — no real SMS sent).
  FAST2SMS_API_KEY: z.string().optional(),
  FAST2SMS_OTP_TEMPLATE_ID: z.string().optional(), // "otp_id" of a DLT-approved OTP template from the Fast2SMS dashboard

  SANDBOX_HOST: z.string().url('SANDBOX_HOST must be a valid URL'),
  SANDBOX_API_KEY: z.string().min(1, 'SANDBOX_API_KEY is required'),
  SANDBOX_API_SECRET: z.string().min(1, 'SANDBOX_API_SECRET is required'),

  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be a 64-char hex string (32 bytes) — generate with: openssl rand -hex 32'),

  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL'),
  // Separate app from FRONTEND_URL (the consumer host/brand/attendee site) — used for links that
  // must open the admin panel specifically, e.g. the admin-invite password-reset email. Must be
  // a Firebase Auth "authorized domain" (Console → Authentication → Settings) or
  // generatePasswordResetLink() throws "Domain not allowlisted by project".
  ADMIN_URL: z.string().url('ADMIN_URL must be a valid URL').default('https://admin.meetday.ai'),
  ALLOWED_ORIGINS: z.string().optional(), // required in production; comma-separated CORS origins, e.g. https://app.meetday.ai,https://admin.meetday.ai

  INTERNAL_API_KEY: z.string().min(32, 'INTERNAL_API_KEY must be at least 32 characters'),

  AI_SERVER_URL: z.string().url('AI_SERVER_URL must be a valid URL'),

  GCP_PROJECT_ID: z.string().min(1, 'GCP_PROJECT_ID is required'),
  GCP_STORAGE_BUCKET: z.string().min(1, 'GCP_STORAGE_BUCKET is required'),
  GCP_KEY_FILE: z.string().optional(), // omit on GCP infra — SDK uses ADC automatically

  // Bot protection — set RATE_LIMIT_ENABLED=false in .env to disable during local dev/testing
  RATE_LIMIT_ENABLED: z.string().default('true').transform((v) => v !== 'false'),
  IP_WHITELIST: z.string().default('127.0.0.1,::1'),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(), // required in production; omit locally to skip signature check
  RAZORPAY_X_ACCOUNT_NUMBER: z.string().optional(), // platform's Razorpay X current account; required to trigger payouts
  RAZORPAY_PAYOUT_WEBHOOK_SECRET: z.string().optional(), // omit locally to skip payout webhook verification

  PAYOUT_HOLD_DAYS: z.coerce.number().int().nonnegative().default(7), // days after event end before payout is eligible
  TDS_RATE: z.coerce.number().min(0).max(1).default(0.01), // Section 194-O TDS rate (1%)
  MIN_PAYOUT_AMOUNT: z.coerce.number().nonnegative().default(100), // minimum ₹ net amount to issue a payout

  // Grace period before a fallback "you have unread messages" email is sent for a TriChat
  // message — cancelled (never sent) if the recipient reads it before this elapses.
  UNREAD_CHAT_EMAIL_DELAY_MINUTES: z.coerce.number().int().positive().default(10),

  // Meetday's legal identity — the "supplier" printed on customer tax invoices.
  // Fill real values in production before invoices are legally valid.
  COMPANY_LEGAL_NAME: z.string().default('Meetday'),
  COMPANY_GSTIN: z.string().default(''),
  COMPANY_ADDRESS: z.string().default(''),
  COMPANY_SUPPORT_EMAIL: z.string().default(''),

  // HostProfile.id of Meetday's own house account (see prisma/scripts/seed-meetday-host.ts).
  // Excluded from the payout cron — its ticket revenue never leaves the platform, so there's
  // nothing to pay out. Omit in environments where the house account hasn't been provisioned.
  MEETDAY_HOST_PROFILE_ID: z.string().uuid().optional(),

  // Orphaned event-media garbage collector (daily cron). See MediaGcService.
  MEDIA_GC_ENABLED: z.string().default('true').transform((v) => v !== 'false'), // master on/off switch for the cron
  MEDIA_GC_DRY_RUN: z.string().default('true').transform((v) => v !== 'false'), // when true, log what would be deleted but delete nothing
  MEDIA_GC_GRACE_DAYS: z.coerce.number().int().nonnegative().default(7), // only delete objects older than this (guards freshly-uploaded-not-yet-saved)
  MEDIA_GC_MAX_DELETES_PER_RUN: z.coerce.number().int().positive().default(1000), // safety cap: abort if a run would delete more than this
});

export type Env = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }

  return result.data;
}
