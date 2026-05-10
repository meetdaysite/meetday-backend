-- AlterEnum
ALTER TYPE "EventStatus" ADD VALUE 'UNDER_REVIEW';

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "adminRejectionRemark" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
