-- AddColumn to SponsorshipProposal
ALTER TABLE "sponsorship_proposals" ADD COLUMN "brandProfileId" TEXT;

-- CreateIndex
CREATE INDEX "sponsorship_proposals_brandProfileId_idx" ON "sponsorship_proposals"("brandProfileId");

-- AddForeignKey
ALTER TABLE "sponsorship_proposals" ADD CONSTRAINT "sponsorship_proposals_brandProfileId_fkey" FOREIGN KEY ("brandProfileId") REFERENCES "brand_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
