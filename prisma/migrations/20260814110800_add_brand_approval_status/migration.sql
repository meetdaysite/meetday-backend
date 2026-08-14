-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'BRAND_PROFILE_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'BRAND_PROFILE_REJECTED';

-- AlterTable
ALTER TABLE "brand_profiles" ADD COLUMN     "approvalStatus" "HostApprovalStatus" NOT NULL DEFAULT 'PENDING';
