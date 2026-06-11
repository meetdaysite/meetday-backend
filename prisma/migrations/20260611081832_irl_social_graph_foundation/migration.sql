-- AlterTable
ALTER TABLE "events" ADD COLUMN     "graphProcessedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "order_attendees" ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "user_connections" (
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "coAttendCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedCoAttendCount" INTEGER NOT NULL DEFAULT 0,
    "groupBookingCount" INTEGER NOT NULL DEFAULT 0,
    "sharedHostCount" INTEGER NOT NULL DEFAULT 0,
    "sharedCategoryCount" INTEGER NOT NULL DEFAULT 0,
    "firstCoAttendedAt" TIMESTAMP(3),
    "lastCoAttendedAt" TIMESTAMP(3),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_connections_pkey" PRIMARY KEY ("userAId","userBId")
);

-- CreateIndex
CREATE INDEX "user_connections_userAId_weight_idx" ON "user_connections"("userAId", "weight" DESC);

-- CreateIndex
CREATE INDEX "user_connections_userBId_weight_idx" ON "user_connections"("userBId", "weight" DESC);

-- CreateIndex
CREATE INDEX "order_attendees_userId_idx" ON "order_attendees"("userId");

-- AddForeignKey
ALTER TABLE "order_attendees" ADD CONSTRAINT "order_attendees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_connections" ADD CONSTRAINT "user_connections_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_connections" ADD CONSTRAINT "user_connections_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
