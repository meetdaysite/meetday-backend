-- AlterTable
ALTER TABLE "sponsorship_deals" RENAME COLUMN "eventName" TO "projectName";
ALTER TABLE "sponsorship_deals" RENAME COLUMN "eventDate" TO "startDate";
ALTER TABLE "sponsorship_deals" RENAME COLUMN "eventTime" TO "time";
ALTER TABLE "sponsorship_deals" RENAME COLUMN "finalAmount" TO "sponsorshipAmount";

ALTER TABLE "sponsorship_deals" ADD COLUMN "endDate" TIMESTAMP(3);
ALTER TABLE "sponsorship_deals" ADD COLUMN "sponsorshipCategory" TEXT;
ALTER TABLE "sponsorship_deals" ADD COLUMN "barterElements" TEXT;
