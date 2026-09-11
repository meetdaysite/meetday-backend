-- CreateEnum
CREATE TYPE "SpaceDealStatus" AS ENUM ('PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED');

-- CreateTable
CREATE TABLE "space_deals" (
    "id" TEXT NOT NULL,
    "spaceInterestId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "goals" JSONB,
    "venue" TEXT NOT NULL,
    "time" TEXT,
    "targetAudience" JSONB,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "sponsorshipAmount" DECIMAL(65,30) NOT NULL,
    "barterElements" TEXT,
    "deliverables" TEXT NOT NULL,
    "otherTerms" TEXT,
    "additionalNotes" TEXT,
    "status" "SpaceDealStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "changeRequestNote" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "space_deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "space_deals_spaceInterestId_key" ON "space_deals"("spaceInterestId");

-- CreateIndex
CREATE INDEX "space_deals_status_idx" ON "space_deals"("status");

-- AddForeignKey
ALTER TABLE "space_deals" ADD CONSTRAINT "space_deals_spaceInterestId_fkey" FOREIGN KEY ("spaceInterestId") REFERENCES "space_interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_deals" ADD CONSTRAINT "space_deals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
