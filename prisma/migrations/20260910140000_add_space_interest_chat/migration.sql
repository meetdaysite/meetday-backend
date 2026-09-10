-- CreateEnum
CREATE TYPE "SpaceInterestRequesterType" AS ENUM ('BRAND', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "SpaceChatStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "SpaceChatSenderType" AS ENUM ('SPACE', 'BRAND', 'COMMUNITY');

-- CreateTable
CREATE TABLE "space_interests" (
    "id" TEXT NOT NULL,
    "spaceCommunityProfileId" TEXT NOT NULL,
    "requesterType" "SpaceInterestRequesterType" NOT NULL,
    "brandProfileId" TEXT,
    "hostProfileId" TEXT,
    "message" TEXT,
    "chatStatus" "SpaceChatStatus" NOT NULL DEFAULT 'REQUESTED',
    "chatAcceptedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "requesterLastReadAt" TIMESTAMP(3),
    "spaceLastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_chat_messages" (
    "id" TEXT NOT NULL,
    "spaceInterestId" TEXT NOT NULL,
    "senderType" "SpaceChatSenderType" NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaKey" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "space_interests_spaceCommunityProfileId_idx" ON "space_interests"("spaceCommunityProfileId");

-- CreateIndex
CREATE INDEX "space_interests_chatStatus_idx" ON "space_interests"("chatStatus");

-- CreateIndex
CREATE UNIQUE INDEX "space_interests_spaceCommunityProfileId_brandProfileId_key" ON "space_interests"("spaceCommunityProfileId", "brandProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "space_interests_spaceCommunityProfileId_hostProfileId_key" ON "space_interests"("spaceCommunityProfileId", "hostProfileId");

-- CreateIndex
CREATE INDEX "space_chat_messages_spaceInterestId_createdAt_idx" ON "space_chat_messages"("spaceInterestId", "createdAt");

-- AddForeignKey
ALTER TABLE "space_interests" ADD CONSTRAINT "space_interests_spaceCommunityProfileId_fkey" FOREIGN KEY ("spaceCommunityProfileId") REFERENCES "space_community_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_interests" ADD CONSTRAINT "space_interests_brandProfileId_fkey" FOREIGN KEY ("brandProfileId") REFERENCES "brand_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_interests" ADD CONSTRAINT "space_interests_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_chat_messages" ADD CONSTRAINT "space_chat_messages_spaceInterestId_fkey" FOREIGN KEY ("spaceInterestId") REFERENCES "space_interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_chat_messages" ADD CONSTRAINT "space_chat_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
