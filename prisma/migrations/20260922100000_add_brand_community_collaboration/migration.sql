CREATE TABLE "brand_community_collaboration_interests" (
  "id" TEXT NOT NULL,
  "requesterBrandId" TEXT NOT NULL,
  "targetCommunityId" TEXT NOT NULL,
  "chatStatus" "CommunityCollaborationStatus" NOT NULL DEFAULT 'REQUESTED',
  "chatAcceptedAt" TIMESTAMP(3),
  "lastMessageAt" TIMESTAMP(3),
  "requesterLastReadAt" TIMESTAMP(3),
  "targetLastReadAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brand_community_collaboration_interests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brand_community_collaboration_messages" (
  "id" TEXT NOT NULL,
  "collaborationId" TEXT NOT NULL,
  "senderType" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "messageType" "ChatMessageType" NOT NULL DEFAULT 'TEXT',
  "content" TEXT NOT NULL,
  "mediaKey" TEXT,
  "replyToId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brand_community_collaboration_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "brand_community_collaboration_interests_requesterBrandId_targetCommunityId_key"
  ON "brand_community_collaboration_interests"("requesterBrandId", "targetCommunityId");
CREATE INDEX "brand_community_collaboration_interests_requesterBrandId_idx"
  ON "brand_community_collaboration_interests"("requesterBrandId");
CREATE INDEX "brand_community_collaboration_interests_targetCommunityId_idx"
  ON "brand_community_collaboration_interests"("targetCommunityId");
CREATE INDEX "brand_community_collaboration_interests_chatStatus_idx"
  ON "brand_community_collaboration_interests"("chatStatus");
CREATE INDEX "brand_community_collaboration_messages_collaborationId_createdAt_idx"
  ON "brand_community_collaboration_messages"("collaborationId", "createdAt");

ALTER TABLE "brand_community_collaboration_interests"
  ADD CONSTRAINT "brand_community_collaboration_interests_requesterBrandId_fkey"
  FOREIGN KEY ("requesterBrandId") REFERENCES "brand_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brand_community_collaboration_interests"
  ADD CONSTRAINT "brand_community_collaboration_interests_targetCommunityId_fkey"
  FOREIGN KEY ("targetCommunityId") REFERENCES "host_community_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brand_community_collaboration_messages"
  ADD CONSTRAINT "brand_community_collaboration_messages_collaborationId_fkey"
  FOREIGN KEY ("collaborationId") REFERENCES "brand_community_collaboration_interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brand_community_collaboration_messages"
  ADD CONSTRAINT "brand_community_collaboration_messages_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
