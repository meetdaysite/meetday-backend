-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SPONSORSHIP_PROPOSAL_DELETE_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'SPONSORSHIP_PROPOSAL_DELETED_BY_ADMIN';
ALTER TYPE "AuditAction" ADD VALUE 'SPONSORSHIP_PROPOSAL_DELETE_REJECTED';

-- AlterEnum
ALTER TYPE "SponsorshipStatus" ADD VALUE 'DELETE_REQUESTED';

-- AlterTable
ALTER TABLE "host_community_profiles" ADD COLUMN     "secondaryImageKey" TEXT;

-- AlterTable
ALTER TABLE "sponsorship_proposals" ADD COLUMN     "videoUrl" TEXT;
