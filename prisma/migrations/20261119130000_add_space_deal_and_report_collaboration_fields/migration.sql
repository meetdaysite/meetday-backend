-- AlterTable
ALTER TABLE "space_deals" ADD COLUMN "collaborationType" TEXT DEFAULT 'NAMING_RIGHTS';
ALTER TABLE "space_deals" ADD COLUMN "dealData" JSONB;

-- AlterTable
ALTER TABLE "space_deal_reports" ADD COLUMN "endDate" TEXT;
ALTER TABLE "space_deal_reports" ADD COLUMN "reportData" JSONB;
