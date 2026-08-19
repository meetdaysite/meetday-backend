-- AlterTable
ALTER TABLE "sponsorship_interests" ADD COLUMN "hostLastReadAt" TIMESTAMP(3),
ADD COLUMN "brandLastReadAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sponsorship_chat_messages" ADD COLUMN "mediaKey" TEXT;
