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

  SANDBOX_HOST: z.string().url('SANDBOX_HOST must be a valid URL'),
  SANDBOX_API_KEY: z.string().min(1, 'SANDBOX_API_KEY is required'),
  SANDBOX_API_SECRET: z.string().min(1, 'SANDBOX_API_SECRET is required'),

  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be a 64-char hex string (32 bytes) — generate with: openssl rand -hex 32'),

  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL'),
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
