-- CreateEnum
CREATE TYPE "CommunityType" AS ENUM ('MEETDAY_MANAGED_PUBLIC', 'HOST_LED', 'PRIVATE_INVITE_ONLY');

-- CreateEnum
CREATE TYPE "CommunityStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CommunityAccess" AS ENUM ('PUBLIC', 'APPROVAL_REQUIRED', 'INVITE_ONLY');

-- CreateEnum
CREATE TYPE "MemberVisibility" AS ENUM ('ALL_MEMBERS', 'AFTER_ATTENDING', 'HIDDEN');

-- CreateEnum
CREATE TYPE "PostingPermission" AS ENUM ('ALL_MEMBERS', 'ATTENDED_MEMBERS_ONLY', 'ADMINS_ONLY');

-- CreateEnum
CREATE TYPE "ChatPermission" AS ENUM ('ALL_MEMBERS', 'ATTENDED_MEMBERS_ONLY', 'ADMIN_APPROVAL_REQUIRED');

-- CreateEnum
CREATE TYPE "DirectMessagePolicy" AS ENUM ('EVERYONE', 'MUTUAL_ATTENDEES_ONLY', 'DISABLED');

-- CreateEnum
CREATE TYPE "PhotoSharingPolicy" AS ENUM ('REQUIRE_CONSENT_REMINDER', 'OPEN', 'DISABLED');

-- CreateEnum
CREATE TYPE "CommunityRole" AS ENUM ('OWNER', 'MANAGER', 'HOST', 'MODERATOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "CommunityMemberStatus" AS ENUM ('ACTIVE', 'PENDING', 'INVITED', 'BANNED', 'LEFT');

-- CreateEnum
CREATE TYPE "CommunityEventSource" AS ENUM ('MANUAL', 'AUTO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'COMMUNITY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNITY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNITY_PUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNITY_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNITY_MEMBER_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNITY_MEMBER_REMOVED';

-- CreateTable
CREATE TABLE "communities" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "CommunityType" NOT NULL,
    "status" "CommunityStatus" NOT NULL DEFAULT 'DRAFT',
    "access" "CommunityAccess" NOT NULL DEFAULT 'PUBLIC',
    "memberVisibility" "MemberVisibility" NOT NULL DEFAULT 'ALL_MEMBERS',
    "categoryId" TEXT,
    "primaryCity" TEXT,
    "communityCities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "coverImageKey" TEXT,
    "iconKey" TEXT,
    "autoAddMatchingEvents" BOOLEAN NOT NULL DEFAULT false,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "experienceCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_settings" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "chatEnabled" BOOLEAN NOT NULL DEFAULT true,
    "feedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "announcementsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "memberDirectoryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "experiencesTabEnabled" BOOLEAN NOT NULL DEFAULT true,
    "feedPosting" "PostingPermission" NOT NULL DEFAULT 'ALL_MEMBERS',
    "chat" "ChatPermission" NOT NULL DEFAULT 'ALL_MEMBERS',
    "spamDetection" BOOLEAN NOT NULL DEFAULT true,
    "toxicContentDetection" BOOLEAN NOT NULL DEFAULT true,
    "linkFiltering" BOOLEAN NOT NULL DEFAULT true,
    "duplicateContentDetection" BOOLEAN NOT NULL DEFAULT true,
    "reportThreshold" INTEGER NOT NULL DEFAULT 5,
    "dmPolicy" "DirectMessagePolicy" NOT NULL DEFAULT 'MUTUAL_ATTENDEES_ONLY',
    "photoSharing" "PhotoSharingPolicy" NOT NULL DEFAULT 'REQUIRE_CONSENT_REMINDER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_interests" (
    "communityId" TEXT NOT NULL,
    "interestId" TEXT NOT NULL,

    CONSTRAINT "community_interests_pkey" PRIMARY KEY ("communityId","interestId")
);

-- CreateTable
CREATE TABLE "community_members" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CommunityRole" NOT NULL DEFAULT 'MEMBER',
    "status" "CommunityMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedBy" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_events" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" "CommunityEventSource" NOT NULL,
    "addedBy" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "communities_slug_key" ON "communities"("slug");

-- CreateIndex
CREATE INDEX "communities_status_idx" ON "communities"("status");

-- CreateIndex
CREATE INDEX "communities_categoryId_idx" ON "communities"("categoryId");

-- CreateIndex
CREATE INDEX "communities_primaryCity_idx" ON "communities"("primaryCity");

-- CreateIndex
CREATE UNIQUE INDEX "community_settings_communityId_key" ON "community_settings"("communityId");

-- CreateIndex
CREATE INDEX "community_interests_interestId_idx" ON "community_interests"("interestId");

-- CreateIndex
CREATE INDEX "community_members_communityId_role_idx" ON "community_members"("communityId", "role");

-- CreateIndex
CREATE INDEX "community_members_userId_idx" ON "community_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "community_members_communityId_userId_key" ON "community_members"("communityId", "userId");

-- CreateIndex
CREATE INDEX "community_events_eventId_idx" ON "community_events"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "community_events_communityId_eventId_key" ON "community_events"("communityId", "eventId");

-- AddForeignKey
ALTER TABLE "communities" ADD CONSTRAINT "communities_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communities" ADD CONSTRAINT "communities_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_settings" ADD CONSTRAINT "community_settings_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_interests" ADD CONSTRAINT "community_interests_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_interests" ADD CONSTRAINT "community_interests_interestId_fkey" FOREIGN KEY ("interestId") REFERENCES "interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_events" ADD CONSTRAINT "community_events_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_events" ADD CONSTRAINT "community_events_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
