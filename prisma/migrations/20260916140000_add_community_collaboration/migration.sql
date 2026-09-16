-- CreateEnum
CREATE TYPE "CommunityCollaborationStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "community_collaboration_interests" (
    "id" TEXT NOT NULL,
    "requesterCommunityId" TEXT NOT NULL,
    "targetCommunityId" TEXT NOT NULL,
    "message" TEXT,
    "chatStatus" "CommunityCollaborationStatus" NOT NULL DEFAULT 'REQUESTED',
    "chatAcceptedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "requesterLastReadAt" TIMESTAMP(3),
    "targetLastReadAt" TIMESTAMP(3),
    "adminLastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_collaboration_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_collaboration_messages" (
    "id" TEXT NOT NULL,
    "communityCollaborationId" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "messageType" "ChatMessageType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "mediaKey" TEXT,
    "replyToId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_collaboration_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_collaboration_interests_requesterCommunityId_idx" ON "community_collaboration_interests"("requesterCommunityId");

-- CreateIndex
CREATE INDEX "community_collaboration_interests_targetCommunityId_idx" ON "community_collaboration_interests"("targetCommunityId");

-- CreateIndex
CREATE INDEX "community_collaboration_interests_chatStatus_idx" ON "community_collaboration_interests"("chatStatus");

-- CreateIndex
CREATE UNIQUE INDEX "community_collaboration_interests_requesterCommunityId_targetCommunityId_key" ON "community_collaboration_interests"("requesterCommunityId", "targetCommunityId");

-- CreateIndex
CREATE INDEX "community_collaboration_messages_communityCollaborationId_createdAt_idx" ON "community_collaboration_messages"("communityCollaborationId", "createdAt");

-- AddForeignKey
ALTER TABLE "community_collaboration_interests" ADD CONSTRAINT "community_collaboration_interests_requesterCommunityId_fkey" FOREIGN KEY ("requesterCommunityId") REFERENCES "host_community_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_collaboration_interests" ADD CONSTRAINT "community_collaboration_interests_targetCommunityId_fkey" FOREIGN KEY ("targetCommunityId") REFERENCES "host_community_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_collaboration_messages" ADD CONSTRAINT "community_collaboration_messages_communityCollaborationId_fkey" FOREIGN KEY ("communityCollaborationId") REFERENCES "community_collaboration_interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_collaboration_messages" ADD CONSTRAINT "community_collaboration_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_collaboration_messages" ADD CONSTRAINT "community_collaboration_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "community_collaboration_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
