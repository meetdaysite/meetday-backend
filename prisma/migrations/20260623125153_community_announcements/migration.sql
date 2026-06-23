-- CreateEnum
CREATE TYPE "AnnouncementCategory" AS ENUM ('EVENT_DROP', 'EVENT_REMINDER', 'COMMUNITY_UPDATE', 'COMMUNITY_REMINDER', 'GENERAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ANNOUNCEMENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'ANNOUNCEMENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'ANNOUNCEMENT_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'ANNOUNCEMENT_PINNED';
ALTER TYPE "AuditAction" ADD VALUE 'ANNOUNCEMENT_UNPINNED';

-- AlterTable
ALTER TABLE "community_members" ADD COLUMN     "lastReadAnnouncementsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "community_announcements" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "category" "AnnouncementCategory" NOT NULL DEFAULT 'COMMUNITY_UPDATE',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "imageKey" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "bookmarkCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_likes" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_bookmarks" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_announcements_communityId_isPinned_publishedAt_idx" ON "community_announcements"("communityId", "isPinned", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "community_announcements_communityId_publishedAt_idx" ON "community_announcements"("communityId", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "announcement_likes_userId_idx" ON "announcement_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_likes_announcementId_userId_key" ON "announcement_likes"("announcementId", "userId");

-- CreateIndex
CREATE INDEX "announcement_bookmarks_userId_idx" ON "announcement_bookmarks"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_bookmarks_announcementId_userId_key" ON "announcement_bookmarks"("announcementId", "userId");

-- AddForeignKey
ALTER TABLE "community_announcements" ADD CONSTRAINT "community_announcements_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_announcements" ADD CONSTRAINT "community_announcements_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_likes" ADD CONSTRAINT "announcement_likes_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "community_announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_likes" ADD CONSTRAINT "announcement_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_bookmarks" ADD CONSTRAINT "announcement_bookmarks_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "community_announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_bookmarks" ADD CONSTRAINT "announcement_bookmarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
