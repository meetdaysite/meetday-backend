/*
  Warnings:

  - The primary key for the `user_interests` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `userProfileId` on the `user_interests` table. All the data in the column will be lost.
  - You are about to drop the `user_profiles` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `attendeeProfileId` to the `user_interests` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AgeRange" AS ENUM ('UNDER_18', 'AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_PLUS');

-- CreateEnum
CREATE TYPE "VibeType" AS ENUM ('LIFE_OF_PARTY', 'CHILL_OBSERVING', 'HERE_TO_CONNECT', 'OPEN_TO_WHATEVER');

-- CreateEnum
CREATE TYPE "SocialStyle" AS ENUM ('SOLO_EXPLORER', 'OPEN_TO_MEETING', 'BRINGING_GANG');

-- DropForeignKey
ALTER TABLE "user_interests" DROP CONSTRAINT "user_interests_userProfileId_fkey";

-- DropForeignKey
ALTER TABLE "user_profiles" DROP CONSTRAINT "user_profiles_userId_fkey";

-- AlterTable
ALTER TABLE "user_interests" DROP CONSTRAINT "user_interests_pkey",
DROP COLUMN "userProfileId",
ADD COLUMN     "attendeeProfileId" TEXT NOT NULL,
ADD CONSTRAINT "user_interests_pkey" PRIMARY KEY ("attendeeProfileId", "categoryId");

-- DropTable
DROP TABLE "user_profiles";

-- CreateTable
CREATE TABLE "attendee_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "bio" TEXT,
    "city" TEXT,
    "ageRange" "AgeRange",
    "profession" TEXT,
    "vibeType" "VibeType",
    "socialStyle" "SocialStyle",
    "privacy" "ProfileVisibility" NOT NULL DEFAULT 'MEMBERS_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendee_profiles_userId_key" ON "attendee_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "attendee_profiles_username_key" ON "attendee_profiles"("username");

-- CreateIndex
CREATE INDEX "attendee_profiles_city_idx" ON "attendee_profiles"("city");

-- AddForeignKey
ALTER TABLE "attendee_profiles" ADD CONSTRAINT "attendee_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_attendeeProfileId_fkey" FOREIGN KEY ("attendeeProfileId") REFERENCES "attendee_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
