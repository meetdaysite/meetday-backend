-- AlterTable
ALTER TABLE "space_chat_messages" ADD COLUMN "messageType" "ChatMessageType" NOT NULL DEFAULT 'TEXT';

-- CreateTable
CREATE TABLE "space_deal_reports" (
    "id" TEXT NOT NULL,
    "spaceDealId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "eventDate" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "time" TEXT,
    "guestCount" TEXT,
    "ageRange" TEXT,
    "deliverables" JSONB NOT NULL DEFAULT '[]',
    "videoLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "socialLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "revisionNote" TEXT,
    "summary" TEXT NOT NULL,
    "proofKeys" TEXT[],
    "notes" TEXT,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "space_deal_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "space_deal_reports_spaceDealId_key" ON "space_deal_reports"("spaceDealId");

-- AddForeignKey
ALTER TABLE "space_deal_reports" ADD CONSTRAINT "space_deal_reports_spaceDealId_fkey" FOREIGN KEY ("spaceDealId") REFERENCES "space_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_deal_reports" ADD CONSTRAINT "space_deal_reports_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
