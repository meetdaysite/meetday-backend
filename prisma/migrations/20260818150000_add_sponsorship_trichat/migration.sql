-- CreateEnum
CREATE TYPE "SponsorshipChatStatus" AS ENUM ('REQUESTED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "ChatSenderType" AS ENUM ('HOST', 'BRAND', 'ADMIN');

-- AlterTable
ALTER TABLE "sponsorship_interests" ADD COLUMN "chatStatus" "SponsorshipChatStatus" NOT NULL DEFAULT 'REQUESTED',
ADD COLUMN "chatAcceptedAt" TIMESTAMP(3),
ADD COLUMN "lastMessageAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sponsorship_interests_chatStatus_idx" ON "sponsorship_interests"("chatStatus");

-- CreateTable
CREATE TABLE "sponsorship_chat_messages" (
    "id" TEXT NOT NULL,
    "sponsorshipInterestId" TEXT NOT NULL,
    "senderType" "ChatSenderType" NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsorship_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sponsorship_chat_messages_sponsorshipInterestId_createdAt_idx" ON "sponsorship_chat_messages"("sponsorshipInterestId", "createdAt");

-- AddForeignKey
ALTER TABLE "sponsorship_chat_messages" ADD CONSTRAINT "sponsorship_chat_messages_sponsorshipInterestId_fkey" FOREIGN KEY ("sponsorshipInterestId") REFERENCES "sponsorship_interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsorship_chat_messages" ADD CONSTRAINT "sponsorship_chat_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
