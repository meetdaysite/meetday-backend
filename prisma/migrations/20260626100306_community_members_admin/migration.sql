-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'COMMUNITY_MEMBER_BANNED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNITY_MEMBER_UNBANNED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNITY_MEMBER_KICKED';

-- AlterTable
ALTER TABLE "community_members" ADD COLUMN     "bannedAt" TIMESTAMP(3),
ADD COLUMN     "bannedBy" TEXT;

-- CreateTable
CREATE TABLE "community_invites" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_invites_token_key" ON "community_invites"("token");

-- CreateIndex
CREATE INDEX "community_invites_communityId_idx" ON "community_invites"("communityId");

-- AddForeignKey
ALTER TABLE "community_invites" ADD CONSTRAINT "community_invites_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_invites" ADD CONSTRAINT "community_invites_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
