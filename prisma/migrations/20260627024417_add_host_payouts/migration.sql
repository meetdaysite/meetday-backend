-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'ON_HOLD', 'REVERSED');

-- CreateEnum
CREATE TYPE "PayoutMode" AS ENUM ('IMPS', 'NEFT', 'RTGS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PAYOUT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYOUT_TRIGGERED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYOUT_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYOUT_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYOUT_HELD';
ALTER TYPE "AuditAction" ADD VALUE 'PAYOUT_RELEASED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYOUT_REVERSED';

-- CreateTable
CREATE TABLE "host_payouts" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "grossRevenue" DECIMAL(65,30) NOT NULL,
    "platformFee" DECIMAL(65,30) NOT NULL,
    "hostGross" DECIMAL(65,30) NOT NULL,
    "tdsAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "netPayoutAmount" DECIMAL(65,30) NOT NULL,
    "razorpayPayoutId" TEXT,
    "razorpayFundAccountId" TEXT NOT NULL,
    "payoutMode" "PayoutMode" NOT NULL DEFAULT 'IMPS',
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "holdReason" TEXT,
    "initiatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_payout_line_items" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "hostGrossAmount" DECIMAL(65,30) NOT NULL,
    "platformFee" DECIMAL(65,30) NOT NULL,
    "netAmount" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "host_payout_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_payout_history" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "fromStatus" "PayoutStatus",
    "toStatus" "PayoutStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "actorType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_payout_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "host_payouts_razorpayPayoutId_key" ON "host_payouts"("razorpayPayoutId");

-- CreateIndex
CREATE INDEX "host_payouts_hostId_status_idx" ON "host_payouts"("hostId", "status");

-- CreateIndex
CREATE INDEX "host_payouts_status_idx" ON "host_payouts"("status");

-- CreateIndex
CREATE INDEX "host_payouts_eventId_idx" ON "host_payouts"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "host_payouts_eventId_hostId_key" ON "host_payouts"("eventId", "hostId");

-- CreateIndex
CREATE UNIQUE INDEX "host_payout_line_items_orderId_key" ON "host_payout_line_items"("orderId");

-- CreateIndex
CREATE INDEX "host_payout_line_items_payoutId_idx" ON "host_payout_line_items"("payoutId");

-- CreateIndex
CREATE INDEX "host_payout_history_payoutId_idx" ON "host_payout_history"("payoutId");

-- AddForeignKey
ALTER TABLE "host_payouts" ADD CONSTRAINT "host_payouts_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_payouts" ADD CONSTRAINT "host_payouts_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_payout_line_items" ADD CONSTRAINT "host_payout_line_items_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "host_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_payout_line_items" ADD CONSTRAINT "host_payout_line_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_payout_history" ADD CONSTRAINT "host_payout_history_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "host_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
