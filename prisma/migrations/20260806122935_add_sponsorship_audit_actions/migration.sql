-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SPONSORSHIP_PROPOSAL_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SPONSORSHIP_PROPOSAL_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'SPONSORSHIP_PROPOSAL_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'SPONSORSHIP_PROPOSAL_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'SPONSORSHIP_PROPOSAL_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'SPONSORSHIP_PROPOSAL_REVISION_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'SPONSORSHIP_PROPOSAL_REVISION_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'SPONSORSHIP_PROPOSAL_REVISION_REJECTED';
