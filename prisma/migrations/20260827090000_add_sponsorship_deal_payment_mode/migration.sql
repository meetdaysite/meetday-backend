-- CreateEnum
CREATE TYPE "SponsorshipDealPaymentMode" AS ENUM ('ONLINE', 'OFFLINE');

-- AlterTable
ALTER TABLE "sponsorship_deals" ADD COLUMN     "paymentMode" "SponsorshipDealPaymentMode";
