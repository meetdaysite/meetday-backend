-- CreateEnum
CREATE TYPE "SpaceHostChatStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "SpaceHostChatSenderType" AS ENUM ('SPACE', 'HOST', 'ADMIN');

-- CreateEnum
CREATE TYPE "SpaceHostDealStatus" AS ENUM ('PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED');

-- CreateTable
CREATE TABLE "space_host_interests" (
    "id" TEXT NOT NULL,
    "hostProfileId" TEXT NOT NULL,
    "spaceProfileId" TEXT NOT NULL,
    "message" TEXT,
    "chatStatus" "SpaceHostChatStatus" NOT NULL DEFAULT 'REQUESTED',
    "chatAcceptedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "requesterLastReadAt" TIMESTAMP(3),
    "communityLastReadAt" TIMESTAMP(3),
    "adminLastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_host_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_host_chat_messages" (
    "id" TEXT NOT NULL,
    "spaceHostInterestId" TEXT NOT NULL,
    "senderType" "SpaceHostChatSenderType" NOT NULL,
    "senderId" TEXT NOT NULL,
    "messageType" "ChatMessageType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "mediaKey" TEXT,
    "replyToId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_host_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_host_deals" (
    "id" TEXT NOT NULL,
    "spaceHostInterestId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "goals" JSONB,
    "venue" TEXT NOT NULL,
    "time" TEXT,
    "targetAudience" JSONB,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "sponsorshipAmount" DECIMAL(65,30) NOT NULL,
    "barterElements" TEXT,
    "deliverables" TEXT NOT NULL,
    "otherTerms" TEXT,
    "additionalNotes" TEXT,
    "status" "SpaceHostDealStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "changeRequestNote" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "space_host_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_host_deal_reports" (
    "id" TEXT NOT NULL,
    "spaceHostDealId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "eventDate" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "time" TEXT,
    "guestCount" TEXT,
    "ageRange" TEXT,
    "deliverables" JSONB NOT NULL DEFAULT '[]',
    "videoLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "socialLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "revisionNote" TEXT,
    "summary" TEXT NOT NULL,
    "proofKeys" TEXT[],
    "notes" TEXT,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "space_host_deal_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "space_host_interests_hostProfileId_idx" ON "space_host_interests"("hostProfileId");

-- CreateIndex
CREATE INDEX "space_host_interests_spaceProfileId_idx" ON "space_host_interests"("spaceProfileId");

-- CreateIndex
CREATE INDEX "space_host_interests_chatStatus_idx" ON "space_host_interests"("chatStatus");

-- CreateIndex
CREATE UNIQUE INDEX "space_host_interests_hostProfileId_spaceProfileId_key" ON "space_host_interests"("hostProfileId", "spaceProfileId");

-- CreateIndex
CREATE INDEX "space_host_chat_messages_spaceHostInterestId_createdAt_idx" ON "space_host_chat_messages"("spaceHostInterestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "space_host_deals_spaceHostInterestId_key" ON "space_host_deals"("spaceHostInterestId");

-- CreateIndex
CREATE INDEX "space_host_deals_status_idx" ON "space_host_deals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "space_host_deal_reports_spaceHostDealId_key" ON "space_host_deal_reports"("spaceHostDealId");

-- AddForeignKey
ALTER TABLE "space_host_interests" ADD CONSTRAINT "space_host_interests_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_host_interests" ADD CONSTRAINT "space_host_interests_spaceProfileId_fkey" FOREIGN KEY ("spaceProfileId") REFERENCES "space_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_host_chat_messages" ADD CONSTRAINT "space_host_chat_messages_spaceHostInterestId_fkey" FOREIGN KEY ("spaceHostInterestId") REFERENCES "space_host_interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_host_chat_messages" ADD CONSTRAINT "space_host_chat_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_host_chat_messages" ADD CONSTRAINT "space_host_chat_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "space_host_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_host_deals" ADD CONSTRAINT "space_host_deals_spaceHostInterestId_fkey" FOREIGN KEY ("spaceHostInterestId") REFERENCES "space_host_interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_host_deals" ADD CONSTRAINT "space_host_deals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_host_deal_reports" ADD CONSTRAINT "space_host_deal_reports_spaceHostDealId_fkey" FOREIGN KEY ("spaceHostDealId") REFERENCES "space_host_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_host_deal_reports" ADD CONSTRAINT "space_host_deal_reports_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
