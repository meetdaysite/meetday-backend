-- AlterTable
ALTER TABLE "community_members" ADD COLUMN     "activityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "eventsAttendedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "messageCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "community_members_communityId_activityScore_idx" ON "community_members"("communityId", "activityScore" DESC);

-- CreateIndex
CREATE INDEX "community_members_communityId_lastActivityAt_idx" ON "community_members"("communityId", "lastActivityAt" DESC);

-- CreateIndex
CREATE INDEX "community_members_communityId_status_joinedAt_idx" ON "community_members"("communityId", "status", "joinedAt");
