-- AlterEnum
ALTER TYPE "SpaceChatSenderType" ADD VALUE 'ADMIN';

-- AlterTable
ALTER TABLE "space_interests" ADD COLUMN "adminLastReadAt" TIMESTAMP(3);
