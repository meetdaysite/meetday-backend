/*
  Warnings:

  - You are about to drop the column `currentEpoch` on the `community_dm_conversations` table. All the data in the column will be lost.
  - You are about to drop the column `ciphertext` on the `community_dm_messages` table. All the data in the column will be lost.
  - You are about to drop the column `keyEpoch` on the `community_dm_messages` table. All the data in the column will be lost.
  - You are about to drop the column `nonce` on the `community_dm_messages` table. All the data in the column will be lost.
  - You are about to drop the `dm_conversation_device_keys` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `dm_conversation_master_keys` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user_devices` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user_key_backups` table. If the table is not empty, all the data it contains will be lost.

*/
-- Purge pre-existing DM messages: their bodies were E2EE ciphertext (in the
-- dropped `ciphertext` column) and cannot be migrated to server-managed `content`.
-- Conversations (intro/consent state only) are preserved.
DELETE FROM "community_dm_read_states";
DELETE FROM "community_dm_messages";

-- DropForeignKey
ALTER TABLE "dm_conversation_device_keys" DROP CONSTRAINT "dm_conversation_device_keys_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "dm_conversation_master_keys" DROP CONSTRAINT "dm_conversation_master_keys_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "user_devices" DROP CONSTRAINT "user_devices_userId_fkey";

-- DropForeignKey
ALTER TABLE "user_key_backups" DROP CONSTRAINT "user_key_backups_userId_fkey";

-- AlterTable
ALTER TABLE "community_dm_conversations" DROP COLUMN "currentEpoch";

-- AlterTable
ALTER TABLE "community_dm_messages" DROP COLUMN "ciphertext",
DROP COLUMN "keyEpoch",
DROP COLUMN "nonce";

-- DropTable
DROP TABLE "dm_conversation_device_keys";

-- DropTable
DROP TABLE "dm_conversation_master_keys";

-- DropTable
DROP TABLE "user_devices";

-- DropTable
DROP TABLE "user_key_backups";
