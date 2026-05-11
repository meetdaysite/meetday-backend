/*
  Warnings:

  - You are about to drop the column `maskedAadhaar` on the `host_profiles` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PanVerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'FAILED');

-- AlterTable
ALTER TABLE "host_profiles" DROP COLUMN "maskedAadhaar",
ADD COLUMN     "panVerificationReference" TEXT,
ADD COLUMN     "panVerificationStatus" "PanVerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED';
