-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'KYC_DETAILS_VIEWED';

-- AlterTable
ALTER TABLE "host_payout_accounts" ADD COLUMN     "accountNumberEncrypted" TEXT,
ADD COLUMN     "ifscCode" TEXT;
