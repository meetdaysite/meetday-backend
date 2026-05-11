// Runs before each E2E test file (via jest-e2e.json setupFiles).
// Sets all env vars required by Zod schema so ConfigModule does not throw.
// All values are fake — external services (Firebase, Razorpay, Sandbox) are
// mocked at the test-file level via jest.mock().

process.env.NODE_ENV = 'test';
process.env.PORT = '3001';

// Use a dedicated test database — run migrations before E2E tests.
// Defaults to the docker-compose postgres with a _test suffix.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://meetday:meetday@localhost:5432/meetday_test';

process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';

process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY = 'mock-private-key';

process.env.MAIL_HOST = 'localhost';
process.env.MAIL_PORT = '1025';
process.env.MAIL_USER = 'test';
process.env.MAIL_PASS = 'test';
process.env.MAIL_FROM = 'noreply@test.com';

process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_razorpay_secret';

process.env.SANDBOX_HOST = 'https://api.sandbox.co.in';
process.env.SANDBOX_API_KEY = 'mock_sandbox_key';
process.env.SANDBOX_API_SECRET = 'mock_sandbox_secret';

// 64-char hex key = 32 bytes for AES-256-GCM
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

process.env.FRONTEND_URL = 'http://localhost:3000';
