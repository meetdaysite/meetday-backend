-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('BRAND', 'AGENCY');

-- AlterTable
ALTER TABLE "brand_profiles" ADD COLUMN     "aboutCompany" TEXT,
ADD COLUMN     "companyType" "CompanyType",
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "logoKey" TEXT,
ADD COLUMN     "workEmail" TEXT;
