/*
  Warnings:

  - You are about to drop the column `isKycVerified` on the `users` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "HostPlan" AS ENUM ('DISCOVER', 'SELL', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'EXPIRED', 'PAST_DUE');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "HostApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutAccountStatus" AS ENUM ('PENDING_PENNY_DROP', 'PENNY_DROP_FAILED', 'PENDING_ADMIN_REVIEW', 'APPROVED', 'REJECTED', 'DEACTIVATED');

-- AlterTable
ALTER TABLE "users" DROP COLUMN "isKycVerified";

-- CreateTable
CREATE TABLE "host_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hostBio" TEXT,
    "tagline" TEXT,
    "city" TEXT,
    "languages" TEXT[],
    "socialLinks" JSONB,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "kycVerifiedAt" TIMESTAMP(3),
    "kycFailureReason" TEXT,
    "approvalStatus" "HostApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectionReason" TEXT,
    "currentPlan" "HostPlan" NOT NULL DEFAULT 'DISCOVER',
    "totalEventsHosted" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DOUBLE PRECISION,
    "totalReviews" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_experience_categories" (
    "hostProfileId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "host_experience_categories_pkey" PRIMARY KEY ("hostProfileId","categoryId")
);

-- CreateTable
CREATE TABLE "host_payout_accounts" (
    "id" TEXT NOT NULL,
    "hostProfileId" TEXT NOT NULL,
    "razorpayContactId" TEXT,
    "razorpayFundAccountId" TEXT,
    "maskedAccountNumber" TEXT,
    "bankName" TEXT,
    "accountHolderName" TEXT,
    "accountType" TEXT,
    "status" "PayoutAccountStatus" NOT NULL DEFAULT 'PENDING_PENNY_DROP',
    "pennyDropReference" TEXT,
    "pennyDropInitiatedAt" TIMESTAMP(3),
    "pennyDropCompletedAt" TIMESTAMP(3),
    "pennyDropFailReason" TEXT,
    "verifiedBy" TEXT,
    "adminReviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "kycStatusAtSubmission" "KycStatus",
    "deactivatedAt" TIMESTAMP(3),
    "deactivationReason" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_payout_account_history" (
    "id" TEXT NOT NULL,
    "hostPayoutAccountId" TEXT NOT NULL,
    "changedBy" TEXT,
    "previousStatus" "PayoutAccountStatus",
    "newStatus" "PayoutAccountStatus",
    "previousMaskedAccountNumber" TEXT,
    "newMaskedAccountNumber" TEXT,
    "previousBankName" TEXT,
    "newBankName" TEXT,
    "previousAccountHolderName" TEXT,
    "newAccountHolderName" TEXT,
    "changeReason" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_payout_account_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_subscriptions" (
    "id" TEXT NOT NULL,
    "hostProfileId" TEXT NOT NULL,
    "plan" "HostPlan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "billingCycle" "BillingCycle",
    "lockedYearlyPrice" DOUBLE PRECISION,
    "lockedMonthlyPrice" DOUBLE PRECISION,
    "lockedFeeRate" DOUBLE PRECISION NOT NULL,
    "razorpaySubscriptionId" TEXT,
    "razorpayPlanId" TEXT,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "plan" "HostPlan" NOT NULL,
    "yearlyPrice" DOUBLE PRECISION,
    "monthlyPrice" DOUBLE PRECISION,
    "platformFeeRate" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plan_history" (
    "id" TEXT NOT NULL,
    "subscriptionPlanId" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "previousYearlyPrice" DOUBLE PRECISION,
    "previousMonthlyPrice" DOUBLE PRECISION,
    "previousFeeRate" DOUBLE PRECISION,
    "newYearlyPrice" DOUBLE PRECISION,
    "newMonthlyPrice" DOUBLE PRECISION,
    "newFeeRate" DOUBLE PRECISION,
    "changeReason" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "notificationSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plan_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "host_profiles_userId_key" ON "host_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "host_payout_accounts_hostProfileId_key" ON "host_payout_accounts"("hostProfileId");

-- CreateIndex
CREATE INDEX "host_payout_accounts_status_idx" ON "host_payout_accounts"("status");

-- CreateIndex
CREATE INDEX "host_payout_accounts_verifiedBy_idx" ON "host_payout_accounts"("verifiedBy");

-- CreateIndex
CREATE INDEX "host_payout_account_history_hostPayoutAccountId_idx" ON "host_payout_account_history"("hostPayoutAccountId");

-- CreateIndex
CREATE INDEX "host_payout_account_history_changedBy_idx" ON "host_payout_account_history"("changedBy");

-- CreateIndex
CREATE UNIQUE INDEX "host_subscriptions_razorpaySubscriptionId_key" ON "host_subscriptions"("razorpaySubscriptionId");

-- CreateIndex
CREATE INDEX "host_subscriptions_hostProfileId_idx" ON "host_subscriptions"("hostProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_plan_key" ON "subscription_plans"("plan");

-- AddForeignKey
ALTER TABLE "host_profiles" ADD CONSTRAINT "host_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_profiles" ADD CONSTRAINT "host_profiles_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_experience_categories" ADD CONSTRAINT "host_experience_categories_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_experience_categories" ADD CONSTRAINT "host_experience_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_payout_accounts" ADD CONSTRAINT "host_payout_accounts_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_payout_accounts" ADD CONSTRAINT "host_payout_accounts_verifiedBy_fkey" FOREIGN KEY ("verifiedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_payout_account_history" ADD CONSTRAINT "host_payout_account_history_hostPayoutAccountId_fkey" FOREIGN KEY ("hostPayoutAccountId") REFERENCES "host_payout_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_payout_account_history" ADD CONSTRAINT "host_payout_account_history_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_subscriptions" ADD CONSTRAINT "host_subscriptions_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plan_history" ADD CONSTRAINT "subscription_plan_history_subscriptionPlanId_fkey" FOREIGN KEY ("subscriptionPlanId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plan_history" ADD CONSTRAINT "subscription_plan_history_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
