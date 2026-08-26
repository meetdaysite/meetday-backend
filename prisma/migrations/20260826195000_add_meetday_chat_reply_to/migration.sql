-- AlterTable
ALTER TABLE "meetday_chat_messages" ADD COLUMN "replyToId" TEXT;

-- AddForeignKey
ALTER TABLE "meetday_chat_messages" ADD CONSTRAINT "meetday_chat_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "meetday_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
