-- AlterTable
ALTER TABLE "sponsorship_proposals" ADD COLUMN     "venues" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: carry each existing row's single `venue` into the new `venues` array
UPDATE "sponsorship_proposals" SET "venues" = ARRAY["venue"] WHERE "venue" IS NOT NULL AND "venue" != '';
