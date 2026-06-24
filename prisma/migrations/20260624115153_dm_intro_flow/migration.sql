-- CreateEnum
CREATE TYPE "DmConversationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable: add status (default PENDING), respondedAt, and initiatorId (nullable for now to allow backfill)
ALTER TABLE "community_dm_conversations" ADD COLUMN     "initiatorId" TEXT,
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "status" "DmConversationStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill existing conversations: they predate the intro flow, so treat them as
-- already-accepted with participant1 as the (nominal) initiator.
UPDATE "community_dm_conversations"
SET "status" = 'ACCEPTED',
    "initiatorId" = "participant1Id",
    "respondedAt" = "createdAt"
WHERE "initiatorId" IS NULL;

-- Now enforce NOT NULL on initiatorId
ALTER TABLE "community_dm_conversations" ALTER COLUMN "initiatorId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "community_dm_conversations_communityId_status_idx" ON "community_dm_conversations"("communityId", "status");
