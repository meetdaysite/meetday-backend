import { envSchema } from './env.schema';

export default () => {
  // envSchema has already been validated by ConfigModule's `validate` hook,
  // so this parse is safe and gives us coerced, typed values.
  const env = envSchema.parse(process.env);

  return {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    database: {
      url: env.DATABASE_URL,
    },
    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
    },
    firebase: {
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    mail: {
      host: env.MAIL_HOST,
      port: env.MAIL_PORT,
      user: env.MAIL_USER,
      pass: env.MAIL_PASS,
      from: env.MAIL_FROM,
    },
    razorpay: {
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
    },
    sandbox: {
      host: env.SANDBOX_HOST,
      apiKey: env.SANDBOX_API_KEY,
      apiSecret: env.SANDBOX_API_SECRET,
    },
    crypto: {
      encryptionKey: env.ENCRYPTION_KEY,
    },
    frontendUrl: env.FRONTEND_URL,
  };
};
