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
  };
};
