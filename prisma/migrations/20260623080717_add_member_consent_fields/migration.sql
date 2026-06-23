-- CreateEnum
CREATE TYPE "MemberProfileVisibility" AS ENUM ('EVENT_ATTENDEES_ONLY', 'COMMUNITY_MEMBERS', 'PRIVATE');

-- AlterEnum
ALTER TYPE "ConsentType" ADD VALUE 'COMMUNITY_GUIDELINES';

-- AlterTable
ALTER TABLE "community_members" ADD COLUMN     "guidelinesAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "profileVisibility" "MemberProfileVisibility" NOT NULL DEFAULT 'EVENT_ATTENDEES_ONLY';
