-- CreateEnum
CREATE TYPE "MeetdayChatSenderType" AS ENUM ('USER', 'ADMIN');

-- CreateTable
CREATE TABLE "meetday_chat_threads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "userLastReadAt" TIMESTAMP(3),
    "adminLastReadAt" TIMESTAMP(3),

    CONSTRAINT "meetday_chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetday_chat_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderType" "MeetdayChatSenderType" NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meetday_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meetday_chat_threads_userId_key" ON "meetday_chat_threads"("userId");

-- CreateIndex
CREATE INDEX "meetday_chat_messages_threadId_createdAt_idx" ON "meetday_chat_messages"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "meetday_chat_threads" ADD CONSTRAINT "meetday_chat_threads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetday_chat_messages" ADD CONSTRAINT "meetday_chat_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "meetday_chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetday_chat_messages" ADD CONSTRAINT "meetday_chat_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
