/*
  Warnings:

  - You are about to drop the column `city` on the `host_profiles` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "HostType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- AlterTable
ALTER TABLE "host_profiles" DROP COLUMN "city",
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "hostType" "HostType",
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "maskedAadhaar" TEXT,
ADD COLUMN     "operatingCities" TEXT[],
ADD COLUMN     "panEncrypted" TEXT,
ADD COLUMN     "portfolioLinks" TEXT[],
ADD COLUMN     "totalEventsPreviouslyHosted" INTEGER,
ADD COLUMN     "yearsOfExperience" INTEGER;

-- CreateTable
CREATE TABLE "host_addresses" (
    "id" TEXT NOT NULL,
    "hostProfileId" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "host_addresses_hostProfileId_key" ON "host_addresses"("hostProfileId");

-- AddForeignKey
ALTER TABLE "host_addresses" ADD CONSTRAINT "host_addresses_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
