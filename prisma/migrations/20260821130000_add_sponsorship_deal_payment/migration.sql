-- CreateEnum
CREATE TYPE "SponsorshipDealPaymentStatus" AS ENUM ('UNPAID', 'PAID');

-- AlterTable
ALTER TABLE "sponsorship_deals" ADD COLUMN "paymentStatus" "SponsorshipDealPaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN "razorpayOrderId" TEXT,
ADD COLUMN "razorpayPaymentId" TEXT,
ADD COLUMN "paidAt" TIMESTAMP(3);
