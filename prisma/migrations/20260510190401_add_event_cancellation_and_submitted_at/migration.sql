-- AlterTable
ALTER TABLE "events" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "submittedAt" TIMESTAMP(3);
