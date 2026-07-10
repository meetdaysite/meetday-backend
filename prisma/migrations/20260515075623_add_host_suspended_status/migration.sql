/*
  Warnings:

  - The values [MARKETING_EMAILS,AGE_VERIFICATION] on the enum `ConsentType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ConsentType_new" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'HOST_KYC_DATA_SHARING', 'HOST_BANK_DATA_SHARING');
ALTER TABLE "consent_records" ALTER COLUMN "consentType" TYPE "ConsentType_new" USING ("consentType"::text::"ConsentType_new");
ALTER TYPE "ConsentType" RENAME TO "ConsentType_old";
ALTER TYPE "ConsentType_new" RENAME TO "ConsentType";
DROP TYPE "ConsentType_old";
COMMIT;

-- AlterEnum
ALTER TYPE "HostApprovalStatus" ADD VALUE 'SUSPENDED';
