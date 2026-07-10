-- CreateTable
CREATE TABLE "event_scanner_sessions" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_scanner_sessions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "order_attendees" ADD COLUMN "scannedBySessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "event_scanner_sessions_token_key" ON "event_scanner_sessions"("token");

-- CreateIndex
CREATE INDEX "event_scanner_sessions_eventId_idx" ON "event_scanner_sessions"("eventId");

-- CreateIndex
CREATE INDEX "event_scanner_sessions_token_idx" ON "event_scanner_sessions"("token");

-- CreateIndex
CREATE INDEX "order_attendees_scannedBySessionId_idx" ON "order_attendees"("scannedBySessionId");

-- AddForeignKey
ALTER TABLE "event_scanner_sessions" ADD CONSTRAINT "event_scanner_sessions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_scanner_sessions" ADD CONSTRAINT "event_scanner_sessions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_attendees" ADD CONSTRAINT "order_attendees_scannedBySessionId_fkey" FOREIGN KEY ("scannedBySessionId") REFERENCES "event_scanner_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
