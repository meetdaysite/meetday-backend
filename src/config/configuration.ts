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
      apiKey: env.RESEND_API_KEY,
      from: env.MAIL_FROM,
    },
    razorpay: {
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
      xAccountNumber: env.RAZORPAY_X_ACCOUNT_NUMBER,
      payoutWebhookSecret: env.RAZORPAY_PAYOUT_WEBHOOK_SECRET,
    },
    fast2sms: {
      apiKey: env.FAST2SMS_API_KEY,
      otpTemplateId: env.FAST2SMS_OTP_TEMPLATE_ID,
    },
    payout: {
      holdDays: env.PAYOUT_HOLD_DAYS,
      tdsRate: env.TDS_RATE,
      minPayoutAmount: env.MIN_PAYOUT_AMOUNT,
    },
    unreadChatEmailDelayMinutes: env.UNREAD_CHAT_EMAIL_DELAY_MINUTES,
    sandbox: {
      host: env.SANDBOX_HOST,
      apiKey: env.SANDBOX_API_KEY,
      apiSecret: env.SANDBOX_API_SECRET,
    },
    crypto: {
      encryptionKey: env.ENCRYPTION_KEY,
    },
    frontendUrl: env.FRONTEND_URL,
    adminUrl: env.ADMIN_URL,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    internalApiKey: env.INTERNAL_API_KEY,
    aiServerUrl: env.AI_SERVER_URL,
    gcs: {
      projectId: env.GCP_PROJECT_ID,
      bucket: env.GCP_STORAGE_BUCKET,
      keyFile: env.GCP_KEY_FILE, // undefined on GCP infra → SDK falls back to ADC
    },
    rateLimitEnabled: env.RATE_LIMIT_ENABLED,
    ipWhitelist: env.IP_WHITELIST.split(',').map((ip) => ip.trim()).filter(Boolean),
    company: {
      legalName: env.COMPANY_LEGAL_NAME,
      gstin: env.COMPANY_GSTIN,
      address: env.COMPANY_ADDRESS,
      supportEmail: env.COMPANY_SUPPORT_EMAIL,
    },
    houseAccount: {
      meetdayHostProfileId: env.MEETDAY_HOST_PROFILE_ID,
    },
    mediaGc: {
      enabled: env.MEDIA_GC_ENABLED,
      dryRun: env.MEDIA_GC_DRY_RUN,
      graceDays: env.MEDIA_GC_GRACE_DAYS,
      maxDeletesPerRun: env.MEDIA_GC_MAX_DELETES_PER_RUN,
    },
  };
};
