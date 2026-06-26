-- CreateEnum
CREATE TYPE "MessageReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'INAPPROPRIATE_CONTENT', 'HATE_SPEECH', 'OTHER');

-- CreateEnum
CREATE TYPE "MessageReportStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReportAction" AS ENUM ('APPROVED', 'REMOVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CHAT_USER_MUTED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_USER_UNMUTED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_WARNING_ISSUED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_WARNING_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_REPORT_RESOLVED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_REPORT_DISMISSED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_KEYWORD_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_KEYWORD_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_LINK_BLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_LINK_UNBLOCKED';

-- AlterTable
ALTER TABLE "community_channels" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "channel_message_reports" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "MessageReportReason" NOT NULL,
    "body" TEXT,
    "status" "MessageReportStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "action" "ReportAction",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_message_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_muted_users" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "mutedBy" TEXT NOT NULL,
    "mutedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mutedUntil" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "community_muted_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_keyword_alerts" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "channelId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_keyword_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_blocked_links" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_blocked_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_content_warnings" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT,
    "reason" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "chat_content_warnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_message_reports_communityId_status_idx" ON "channel_message_reports"("communityId", "status");

-- CreateIndex
CREATE INDEX "channel_message_reports_messageId_idx" ON "channel_message_reports"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_message_reports_messageId_reporterId_key" ON "channel_message_reports"("messageId", "reporterId");

-- CreateIndex
CREATE INDEX "community_muted_users_communityId_idx" ON "community_muted_users"("communityId");

-- CreateIndex
CREATE INDEX "community_muted_users_communityId_userId_idx" ON "community_muted_users"("communityId", "userId");

-- CreateIndex
CREATE INDEX "chat_keyword_alerts_communityId_idx" ON "chat_keyword_alerts"("communityId");

-- CreateIndex
CREATE INDEX "chat_blocked_links_communityId_idx" ON "chat_blocked_links"("communityId");

-- CreateIndex
CREATE INDEX "chat_content_warnings_communityId_idx" ON "chat_content_warnings"("communityId");

-- CreateIndex
CREATE INDEX "chat_content_warnings_userId_communityId_idx" ON "chat_content_warnings"("userId", "communityId");

-- AddForeignKey
ALTER TABLE "channel_message_reports" ADD CONSTRAINT "channel_message_reports_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "channel_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_message_reports" ADD CONSTRAINT "channel_message_reports_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "community_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_message_reports" ADD CONSTRAINT "channel_message_reports_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_message_reports" ADD CONSTRAINT "channel_message_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_message_reports" ADD CONSTRAINT "channel_message_reports_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_muted_users" ADD CONSTRAINT "community_muted_users_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_muted_users" ADD CONSTRAINT "community_muted_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_muted_users" ADD CONSTRAINT "community_muted_users_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "community_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_muted_users" ADD CONSTRAINT "community_muted_users_mutedBy_fkey" FOREIGN KEY ("mutedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_keyword_alerts" ADD CONSTRAINT "chat_keyword_alerts_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_keyword_alerts" ADD CONSTRAINT "chat_keyword_alerts_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "community_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_keyword_alerts" ADD CONSTRAINT "chat_keyword_alerts_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_blocked_links" ADD CONSTRAINT "chat_blocked_links_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_blocked_links" ADD CONSTRAINT "chat_blocked_links_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_content_warnings" ADD CONSTRAINT "chat_content_warnings_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_content_warnings" ADD CONSTRAINT "chat_content_warnings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_content_warnings" ADD CONSTRAINT "chat_content_warnings_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "channel_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_content_warnings" ADD CONSTRAINT "chat_content_warnings_issuedBy_fkey" FOREIGN KEY ("issuedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
