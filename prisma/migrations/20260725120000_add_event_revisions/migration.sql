-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'EVENT_REVISION_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'EVENT_REVISION_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'EVENT_REVISION_REJECTED';

-- CreateTable
CREATE TABLE "event_revisions" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "touchesVenue" BOOLEAN NOT NULL DEFAULT false,
    "status" "RevisionStatus" NOT NULL DEFAULT 'PENDING',
    "adminRemark" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "submittedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_revisions_eventId_status_idx" ON "event_revisions"("eventId", "status");

-- CreateIndex
CREATE INDEX "event_revisions_status_touchesVenue_idx" ON "event_revisions"("status", "touchesVenue");

-- AddForeignKey
ALTER TABLE "event_revisions" ADD CONSTRAINT "event_revisions_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_revisions" ADD CONSTRAINT "event_revisions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
