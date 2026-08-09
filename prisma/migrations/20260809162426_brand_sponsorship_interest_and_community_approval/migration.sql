-- AlterTable
ALTER TABLE "host_community_profiles" ADD COLUMN     "adminRejectionRemark" TEXT,
ADD COLUMN     "approvalStatus" "HostApprovalStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT;

-- AlterTable
ALTER TABLE "host_profiles" ADD COLUMN     "communityName" TEXT;

-- CreateTable
CREATE TABLE "sponsorship_interests" (
    "id" TEXT NOT NULL,
    "sponsorshipProposalId" TEXT NOT NULL,
    "brandProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsorship_interests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sponsorship_interests_sponsorshipProposalId_idx" ON "sponsorship_interests"("sponsorshipProposalId");

-- CreateIndex
CREATE INDEX "sponsorship_interests_brandProfileId_idx" ON "sponsorship_interests"("brandProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "sponsorship_interests_sponsorshipProposalId_brandProfileId_key" ON "sponsorship_interests"("sponsorshipProposalId", "brandProfileId");

-- CreateIndex
CREATE INDEX "host_community_profiles_approvalStatus_idx" ON "host_community_profiles"("approvalStatus");

-- AddForeignKey
ALTER TABLE "sponsorship_interests" ADD CONSTRAINT "sponsorship_interests_sponsorshipProposalId_fkey" FOREIGN KEY ("sponsorshipProposalId") REFERENCES "sponsorship_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsorship_interests" ADD CONSTRAINT "sponsorship_interests_brandProfileId_fkey" FOREIGN KEY ("brandProfileId") REFERENCES "brand_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_community_profiles" ADD CONSTRAINT "host_community_profiles_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
