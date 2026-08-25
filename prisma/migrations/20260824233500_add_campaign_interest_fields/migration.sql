-- AlterTable
ALTER TABLE "sponsorship_interests" ALTER COLUMN "sponsorshipProposalId" DROP NOT NULL,
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "hostProfileId" TEXT;

-- CreateIndex
CREATE INDEX "sponsorship_interests_campaignId_idx" ON "sponsorship_interests"("campaignId");

-- CreateIndex
CREATE INDEX "sponsorship_interests_hostProfileId_idx" ON "sponsorship_interests"("hostProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "sponsorship_interests_campaignId_hostProfileId_key" ON "sponsorship_interests"("campaignId", "hostProfileId");

-- AddForeignKey
ALTER TABLE "sponsorship_interests" ADD CONSTRAINT "sponsorship_interests_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsorship_interests" ADD CONSTRAINT "sponsorship_interests_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
