-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_REGISTERED', 'USER_LOGGED_IN', 'USER_DELETED', 'USER_RESTORED', 'KYC_SUBMITTED', 'KYC_APPROVED', 'KYC_REJECTED', 'KYC_RESUBMITTED', 'PAYOUT_ACCOUNT_ADDED', 'PAYOUT_ACCOUNT_APPROVED', 'PAYOUT_ACCOUNT_DEACTIVATED', 'EVENT_CREATED', 'EVENT_SUBMITTED_FOR_REVIEW', 'EVENT_APPROVED', 'EVENT_REJECTED', 'EVENT_PUBLISHED', 'EVENT_CANCELLED', 'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'REFUND_INITIATED', 'REFUND_COMPLETED', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_UPGRADED', 'SUBSCRIPTION_CANCELLED', 'ADMIN_HOST_SUSPENDED', 'ADMIN_HOST_RESTORED', 'ADMIN_PLAN_PRICE_CHANGED', 'SCANNER_SESSION_CREATED', 'SCANNER_SESSION_EXPIRED', 'TICKET_SCANNED', 'DATA_EXPORT_REQUESTED', 'DATA_DELETION_REQUESTED');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'MARKETING_EMAILS', 'HOST_KYC_DATA_SHARING', 'HOST_BANK_DATA_SHARING', 'AGE_VERIFICATION');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorRole" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "consentType" "ConsentType" NOT NULL,
    "version" TEXT NOT NULL,
    "consentText" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "consent_records_userId_consentType_idx" ON "consent_records"("userId", "consentType");

-- CreateIndex
CREATE INDEX "consent_records_userId_isActive_idx" ON "consent_records"("userId", "isActive");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
