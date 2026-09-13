-- Move Pop-up/Branding sponsorship offering fields from sponsorship_proposals (per-proposal) to
-- space_community_profiles (per-profile, fixed offering shown alongside every proposal).

-- AlterTable: add to space_community_profiles
ALTER TABLE "space_community_profiles" ADD COLUMN "popupDays" TEXT;
ALTER TABLE "space_community_profiles" ADD COLUMN "popupPrice" TEXT;
ALTER TABLE "space_community_profiles" ADD COLUMN "brandingDays" TEXT;
ALTER TABLE "space_community_profiles" ADD COLUMN "brandingPrice" TEXT;

-- AlterTable: drop from sponsorship_proposals
ALTER TABLE "sponsorship_proposals" DROP COLUMN "popupDays";
ALTER TABLE "sponsorship_proposals" DROP COLUMN "popupPrice";
ALTER TABLE "sponsorship_proposals" DROP COLUMN "brandingDays";
ALTER TABLE "sponsorship_proposals" DROP COLUMN "brandingPrice";
