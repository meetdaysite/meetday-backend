-- AlterTable
ALTER TABLE "sponsorship_deals" ADD COLUMN "platformFeeAmount" DECIMAL(65,30),
ADD COLUMN "taxAmount" DECIMAL(65,30),
ADD COLUMN "totalAmount" DECIMAL(65,30),
ADD COLUMN "paymentExpiresAt" TIMESTAMP(3),
ADD COLUMN "invoicePdfKey" TEXT;
