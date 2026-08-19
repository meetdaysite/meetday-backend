-- CreateEnum
CREATE TYPE "ChatMessageType" AS ENUM ('TEXT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SponsorshipDealStatus" AS ENUM ('PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED');

-- AlterTable
ALTER TABLE "sponsorship_chat_messages" ADD COLUMN "messageType" "ChatMessageType" NOT NULL DEFAULT 'TEXT';

-- CreateTable
CREATE TABLE "sponsorship_deals" (
    "id" TEXT NOT NULL,
    "sponsorshipInterestId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "eventTime" TEXT,
    "venue" TEXT NOT NULL,
    "finalAmount" DECIMAL(65,30) NOT NULL,
    "deliverables" TEXT NOT NULL,
    "otherTerms" TEXT,
    "additionalNotes" TEXT,
    "status" "SponsorshipDealStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "changeRequestNote" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsorship_deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sponsorship_deals_sponsorshipInterestId_key" ON "sponsorship_deals"("sponsorshipInterestId");

-- CreateIndex
CREATE INDEX "sponsorship_deals_status_idx" ON "sponsorship_deals"("status");

-- AddForeignKey
ALTER TABLE "sponsorship_deals" ADD CONSTRAINT "sponsorship_deals_sponsorshipInterestId_fkey" FOREIGN KEY ("sponsorshipInterestId") REFERENCES "sponsorship_interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsorship_deals" ADD CONSTRAINT "sponsorship_deals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
