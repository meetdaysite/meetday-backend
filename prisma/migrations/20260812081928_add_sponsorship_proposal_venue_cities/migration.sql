-- AlterTable
ALTER TABLE "sponsorship_proposals" ADD COLUMN     "venueCities" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: every existing row shared one `city` across all its venues — repeat it once per venue
UPDATE "sponsorship_proposals"
SET "venueCities" = ARRAY(SELECT "city" FROM generate_series(1, GREATEST(COALESCE(array_length("venues", 1), 1), 1)))
WHERE "city" IS NOT NULL AND "city" != '';
