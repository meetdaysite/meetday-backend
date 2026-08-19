-- AlterTable
ALTER TABLE "sponsorship_chat_messages" ADD COLUMN "replyToId" TEXT;

-- AddForeignKey
ALTER TABLE "sponsorship_chat_messages" ADD CONSTRAINT "sponsorship_chat_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "sponsorship_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
