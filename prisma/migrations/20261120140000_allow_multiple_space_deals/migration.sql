-- DropIndex
DROP INDEX IF EXISTS "space_deals_spaceInterestId_key";

-- CreateIndex
CREATE INDEX "space_deals_spaceInterestId_idx" ON "space_deals"("spaceInterestId");
