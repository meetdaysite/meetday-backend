-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CHAT_CHANNEL_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_CHANNEL_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_MESSAGE_DELETED_BY_MOD';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_MESSAGE_PINNED';
ALTER TYPE "AuditAction" ADD VALUE 'CHAT_MESSAGE_UNPINNED';

-- CreateTable
CREATE TABLE "community_channels" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "welcomeTitle" TEXT,
    "welcomeBody" TEXT,
    "quickReplies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_messages" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "pinnedBy" TEXT,
    "parentMessageId" TEXT,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_member_states" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "bannerDismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_member_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_dm_conversations" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "participant1Id" TEXT NOT NULL,
    "participant2Id" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_dm_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_dm_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_dm_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_dm_read_states" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_dm_read_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_channels_communityId_position_idx" ON "community_channels"("communityId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "community_channels_communityId_slug_key" ON "community_channels"("communityId", "slug");

-- CreateIndex
CREATE INDEX "channel_messages_channelId_createdAt_idx" ON "channel_messages"("channelId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "channel_messages_communityId_createdAt_idx" ON "channel_messages"("communityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "channel_messages_parentMessageId_idx" ON "channel_messages"("parentMessageId");

-- CreateIndex
CREATE INDEX "message_reactions_messageId_idx" ON "message_reactions"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_messageId_userId_emoji_key" ON "message_reactions"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "channel_member_states_userId_idx" ON "channel_member_states"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_member_states_channelId_userId_key" ON "channel_member_states"("channelId", "userId");

-- CreateIndex
CREATE INDEX "community_dm_conversations_communityId_participant1Id_idx" ON "community_dm_conversations"("communityId", "participant1Id");

-- CreateIndex
CREATE INDEX "community_dm_conversations_communityId_participant2Id_idx" ON "community_dm_conversations"("communityId", "participant2Id");

-- CreateIndex
CREATE UNIQUE INDEX "community_dm_conversations_communityId_participant1Id_parti_key" ON "community_dm_conversations"("communityId", "participant1Id", "participant2Id");

-- CreateIndex
CREATE INDEX "community_dm_messages_conversationId_createdAt_idx" ON "community_dm_messages"("conversationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "community_dm_read_states_userId_idx" ON "community_dm_read_states"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "community_dm_read_states_conversationId_userId_key" ON "community_dm_read_states"("conversationId", "userId");

-- AddForeignKey
ALTER TABLE "community_channels" ADD CONSTRAINT "community_channels_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_channels" ADD CONSTRAINT "community_channels_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "community_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_pinnedBy_fkey" FOREIGN KEY ("pinnedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "channel_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "channel_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_member_states" ADD CONSTRAINT "channel_member_states_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "community_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_member_states" ADD CONSTRAINT "channel_member_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_dm_conversations" ADD CONSTRAINT "community_dm_conversations_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_dm_conversations" ADD CONSTRAINT "community_dm_conversations_participant1Id_fkey" FOREIGN KEY ("participant1Id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_dm_conversations" ADD CONSTRAINT "community_dm_conversations_participant2Id_fkey" FOREIGN KEY ("participant2Id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_dm_messages" ADD CONSTRAINT "community_dm_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "community_dm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_dm_messages" ADD CONSTRAINT "community_dm_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_dm_read_states" ADD CONSTRAINT "community_dm_read_states_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "community_dm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_dm_read_states" ADD CONSTRAINT "community_dm_read_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
