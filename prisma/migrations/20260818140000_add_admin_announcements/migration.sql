-- CreateTable
CREATE TABLE "admin_announcements" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "recipientsSummary" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,

    CONSTRAINT "admin_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_announcements_createdAt_idx" ON "admin_announcements"("createdAt");

-- AddForeignKey
ALTER TABLE "admin_announcements" ADD CONSTRAINT "admin_announcements_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
