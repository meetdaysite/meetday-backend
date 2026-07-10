/*
  Warnings:

  - You are about to drop the column `consentText` on the `consent_records` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `consent_records` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "consent_records" DROP COLUMN "consentText",
DROP COLUMN "version";
