-- AlterTable
ALTER TABLE "space_chat_messages" ADD COLUMN "replyToId" TEXT;

-- AddForeignKey
ALTER TABLE "space_chat_messages" ADD CONSTRAINT "space_chat_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "space_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
