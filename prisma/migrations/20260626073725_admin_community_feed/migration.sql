-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PostReportReason" AS ENUM ('SPAM_OR_PROMOTION', 'INAPPROPRIATE_CONTENT', 'HARASSMENT_OR_ABUSE');

-- CreateEnum
CREATE TYPE "PostReportStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'FEED_POST_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'FEED_POST_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'FEED_POST_CREATED_BY_ADMIN';
ALTER TYPE "AuditAction" ADD VALUE 'FEED_POST_REPORT_RESOLVED';
ALTER TYPE "AuditAction" ADD VALUE 'FEED_POST_REPORT_DISMISSED';

-- AlterTable
ALTER TABLE "community_posts" ADD COLUMN     "status" "PostStatus" NOT NULL DEFAULT 'PUBLISHED';

-- AlterTable
ALTER TABLE "community_settings" ADD COLUMN     "requirePostApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "community_post_reports" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "PostReportReason" NOT NULL,
    "body" TEXT,
    "status" "PostReportStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_post_reports_postId_status_idx" ON "community_post_reports"("postId", "status");

-- CreateIndex
CREATE INDEX "community_post_reports_communityId_status_createdAt_idx" ON "community_post_reports"("communityId", "status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "community_post_reports_postId_reporterId_key" ON "community_post_reports"("postId", "reporterId");

-- CreateIndex
CREATE INDEX "community_posts_communityId_status_createdAt_idx" ON "community_posts"("communityId", "status", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "community_post_reports" ADD CONSTRAINT "community_post_reports_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_reports" ADD CONSTRAINT "community_post_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
