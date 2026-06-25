-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED');

-- AlterTable
ALTER TABLE "community_announcements" ADD COLUMN     "reachCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "status" "AnnouncementStatus" NOT NULL DEFAULT 'PUBLISHED',
ALTER COLUMN "publishedAt" DROP NOT NULL,
ALTER COLUMN "publishedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "community_announcements_communityId_status_createdAt_idx" ON "community_announcements"("communityId", "status", "createdAt" DESC);
