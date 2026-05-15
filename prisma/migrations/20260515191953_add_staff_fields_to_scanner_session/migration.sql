/*
  Warnings:

  - Added the required column `staffEmail` to the `event_scanner_sessions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `staffName` to the `event_scanner_sessions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "event_scanner_sessions" ADD COLUMN     "staffEmail" TEXT NOT NULL,
ADD COLUMN     "staffName" TEXT NOT NULL,
ADD COLUMN     "staffPhone" TEXT,
ALTER COLUMN "label" DROP NOT NULL;
