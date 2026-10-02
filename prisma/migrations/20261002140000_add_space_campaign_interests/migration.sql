-- Add Hub ownership for brand campaign interests.
ALTER TABLE "sponsorship_interests"
ADD COLUMN "spaceProfileId" TEXT;

CREATE UNIQUE INDEX "sponsorship_interests_campaignId_spaceProfileId_key"
ON "sponsorship_interests"("campaignId", "spaceProfileId");

CREATE INDEX "sponsorship_interests_spaceProfileId_idx"
ON "sponsorship_interests"("spaceProfileId");

ALTER TABLE "sponsorship_interests"
ADD CONSTRAINT "sponsorship_interests_spaceProfileId_fkey"
FOREIGN KEY ("spaceProfileId") REFERENCES "space_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
