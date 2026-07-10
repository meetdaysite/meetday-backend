/*
  Warnings:

  - You are about to drop the `user_interests` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "user_interests" DROP CONSTRAINT "user_interests_attendeeProfileId_fkey";

-- DropForeignKey
ALTER TABLE "user_interests" DROP CONSTRAINT "user_interests_categoryId_fkey";

-- DropTable
DROP TABLE "user_interests";
