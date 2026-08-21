-- Create migration script for adding new fields to SponsorshipDealReport
ALTER TABLE "sponsorship_deal_reports"
  ADD COLUMN "projectName" VARCHAR(255) NOT NULL DEFAULT 'Project',
  ADD COLUMN "eventDate" VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN "venue" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "time" VARCHAR(100),
  ADD COLUMN "guestCount" VARCHAR(50),
  ADD COLUMN "ageRange" VARCHAR(50),
  ADD COLUMN "deliverables" JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN "videoLinks" TEXT[] DEFAULT '{}',
  ADD COLUMN "socialLinks" TEXT[] DEFAULT '{}',
  ADD COLUMN "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "revisionNote" TEXT;

-- Remove temporary column defaults for fresh inserts
ALTER TABLE "sponsorship_deal_reports"
  ALTER COLUMN "projectName" DROP DEFAULT,
  ALTER COLUMN "eventDate" DROP DEFAULT,
  ALTER COLUMN "venue" DROP DEFAULT;
