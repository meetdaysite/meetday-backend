-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_categoryId_fkey";

-- AlterTable
ALTER TABLE "events" ALTER COLUMN "categoryId" DROP NOT NULL,
ALTER COLUMN "title" DROP NOT NULL,
ALTER COLUMN "description" DROP NOT NULL,
ALTER COLUMN "eventType" DROP NOT NULL,
ALTER COLUMN "eventDate" DROP NOT NULL,
ALTER COLUMN "startTime" DROP NOT NULL,
ALTER COLUMN "endTime" DROP NOT NULL,
ALTER COLUMN "venueName" DROP NOT NULL,
ALTER COLUMN "fullAddress" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
