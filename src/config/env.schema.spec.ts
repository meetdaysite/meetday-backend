import { validate } from './env.schema';

function makeValidEnv(overrides: Record<string, string> = {}) {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    FIREBASE_PROJECT_ID: 'proj',
    FIREBASE_CLIENT_EMAIL: 'firebase@proj.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: 'key',
    RESEND_API_KEY: 'key',
    MAIL_FROM: 'noreply@meetday.ai',
    RAZORPAY_KEY_ID: 'key',
    RAZORPAY_KEY_SECRET: 'secret',
    SANDBOX_HOST: 'https://sandbox.example.com',
    SANDBOX_API_KEY: 'key',
    SANDBOX_API_SECRET: 'secret',
    ENCRYPTION_KEY: 'a'.repeat(64),
    FRONTEND_URL: 'https://app.meetday.ai',
    INTERNAL_API_KEY: 'a'.repeat(32),
    AI_SERVER_URL: 'https://ai.example.com',
    GCP_PROJECT_ID: 'proj',
    GCP_STORAGE_BUCKET: 'bucket',
    ...overrides,
  };
}

describe('envSchema — ENCRYPTION_KEY', () => {
  it('accepts a valid 64-char hex key', () => {
    expect(() => validate(makeValidEnv())).not.toThrow();
  });

  it('rejects a 64-char key that is not valid hex (right length, wrong content)', () => {
    // e.g. a random password/base64 string that happens to be 64 chars — Buffer.from(str, 'hex')
    // would silently truncate this instead of throwing, producing a key of the wrong byte length
    // for AES-256-GCM at encryption time in production.
    const notHex = 'g'.repeat(64); // 'g' is not a valid hex digit
    expect(() => validate(makeValidEnv({ ENCRYPTION_KEY: notHex }))).toThrow(/ENCRYPTION_KEY must be a 64-char hex string/);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => validate(makeValidEnv({ ENCRYPTION_KEY: 'a'.repeat(32) }))).toThrow(/ENCRYPTION_KEY must be a 64-char hex string/);
  });
});
