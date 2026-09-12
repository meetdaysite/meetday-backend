-- AlterTable: allow Space Partner authorship (hostProfileId becomes optional, add spaceProfileId)
ALTER TABLE "sponsorship_proposals" ALTER COLUMN "hostProfileId" DROP NOT NULL;
ALTER TABLE "sponsorship_proposals" ADD COLUMN "spaceProfileId" TEXT;

-- AlterTable: pitch document is Host-only now (Space Partner proposals never collect one)
ALTER TABLE "sponsorship_proposals" ALTER COLUMN "docKey" DROP NOT NULL;
ALTER TABLE "sponsorship_proposals" ALTER COLUMN "docName" DROP NOT NULL;
ALTER TABLE "sponsorship_proposals" ALTER COLUMN "docType" DROP NOT NULL;
ALTER TABLE "sponsorship_proposals" ALTER COLUMN "docSize" DROP NOT NULL;

-- AlterTable: Space Partner-only Pop-up / Branding sponsorship offerings
ALTER TABLE "sponsorship_proposals" ADD COLUMN "popupDays" TEXT;
ALTER TABLE "sponsorship_proposals" ADD COLUMN "popupPrice" TEXT;
ALTER TABLE "sponsorship_proposals" ADD COLUMN "brandingDays" TEXT;
ALTER TABLE "sponsorship_proposals" ADD COLUMN "brandingPrice" TEXT;

-- CreateIndex
CREATE INDEX "sponsorship_proposals_spaceProfileId_idx" ON "sponsorship_proposals"("spaceProfileId");

-- AddForeignKey
ALTER TABLE "sponsorship_proposals" ADD CONSTRAINT "sponsorship_proposals_spaceProfileId_fkey" FOREIGN KEY ("spaceProfileId") REFERENCES "space_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
