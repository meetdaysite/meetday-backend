-- DropIndex
DROP INDEX IF EXISTS "brand_community_collaboration_deals_collaborationInterestId_key";

-- CreateIndex
CREATE INDEX "brand_community_collaboration_deals_collaborationInterestId_idx" ON "brand_community_collaboration_deals"("collaborationInterestId");
