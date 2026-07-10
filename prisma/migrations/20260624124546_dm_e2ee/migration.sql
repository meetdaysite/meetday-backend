/*
  E2EE cutover: pre-E2EE DM rows hold plaintext `content` and cannot be migrated
  to ciphertext (no client keys exist). Purge legacy DM conversations + messages
  so the inbox starts clean under zero-knowledge E2EE. (Dev cutover; production
  would gate behind a flag.)
*/
DELETE FROM "community_dm_messages";
DELETE FROM "community_dm_read_states";
DELETE FROM "community_dm_conversations";

-- CreateEnum
CREATE TYPE "DmMessageType" AS ENUM ('TEXT', 'IMAGE');

-- AlterTable
ALTER TABLE "community_dm_conversations" DROP COLUMN "lastMessagePreview",
ADD COLUMN     "currentEpoch" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "community_dm_messages" ADD COLUMN     "ciphertext" TEXT,
ADD COLUMN     "keyEpoch" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "mediaKey" TEXT,
ADD COLUMN     "mediaSizeBytes" INTEGER,
ADD COLUMN     "messageType" "DmMessageType" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "nonce" TEXT,
ALTER COLUMN "content" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "identityPublicKey" TEXT NOT NULL,
    "signingPublicKey" TEXT,
    "label" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_key_backups" (
    "userId" TEXT NOT NULL,
    "wrappedMasterKey" TEXT NOT NULL,
    "kdfParams" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_key_backups_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "dm_conversation_device_keys" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "recipientDeviceId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "wrappedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_conversation_device_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dm_conversation_master_keys" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "wrappedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_conversation_master_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_devices_userId_idx" ON "user_devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_userId_deviceId_key" ON "user_devices"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "dm_conversation_device_keys_recipientUserId_recipientDevice_idx" ON "dm_conversation_device_keys"("recipientUserId", "recipientDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "dm_conversation_device_keys_conversationId_recipientDeviceI_key" ON "dm_conversation_device_keys"("conversationId", "recipientDeviceId", "epoch");

-- CreateIndex
CREATE INDEX "dm_conversation_master_keys_userId_idx" ON "dm_conversation_master_keys"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "dm_conversation_master_keys_conversationId_userId_epoch_key" ON "dm_conversation_master_keys"("conversationId", "userId", "epoch");

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_key_backups" ADD CONSTRAINT "user_key_backups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_conversation_device_keys" ADD CONSTRAINT "dm_conversation_device_keys_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "community_dm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_conversation_master_keys" ADD CONSTRAINT "dm_conversation_master_keys_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "community_dm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
