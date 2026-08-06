-- CreateEnum
CREATE TYPE "SponsorshipStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'REJECTED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "sponsorship_proposals" (
    "id" TEXT NOT NULL,
    "hostProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "about" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "venue" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "audienceProfile" TEXT[],
    "ageGroup" TEXT NOT NULL,
    "guestCount" TEXT NOT NULL,
    "docKey" TEXT NOT NULL,
    "docName" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docSize" INTEGER NOT NULL,
    "sponsorTiers" JSONB NOT NULL,
    "status" "SponsorshipStatus" NOT NULL DEFAULT 'DRAFT',
    "pendingRevision" JSONB,
    "adminRejectionRemark" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsorship_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sponsorship_proposals_hostProfileId_idx" ON "sponsorship_proposals"("hostProfileId");

-- CreateIndex
CREATE INDEX "sponsorship_proposals_status_idx" ON "sponsorship_proposals"("status");

-- AddForeignKey
ALTER TABLE "sponsorship_proposals" ADD CONSTRAINT "sponsorship_proposals_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsorship_proposals" ADD CONSTRAINT "sponsorship_proposals_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
