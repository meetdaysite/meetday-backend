-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('EXPERIENCE', 'SPACE');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "type" "CategoryType" NOT NULL DEFAULT 'EXPERIENCE';

-- AlterTable
ALTER TABLE "space_profiles" ADD COLUMN     "socialLinks" JSONB;

-- CreateTable
CREATE TABLE "space_community_profiles" (
    "id" TEXT NOT NULL,
    "spaceProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "about" TEXT NOT NULL,
    "logoKey" TEXT NOT NULL,
    "posterKey" TEXT,
    "numberOfVenues" TEXT NOT NULL,
    "venueCapacity" TEXT NOT NULL,
    "communitySize" TEXT NOT NULL,
    "experiencesPerYear" TEXT NOT NULL,
    "activeLocations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "centreShowcaseImageKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "videoLink" TEXT,
    "pastEvents" JSONB,
    "brandsWorkedWith" JSONB,
    "pendingRevision" JSONB,
    "approvalStatus" "HostApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "adminRejectionRemark" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "space_community_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_community_profile_categories" (
    "spaceCommunityProfileId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "space_community_profile_categories_pkey" PRIMARY KEY ("spaceCommunityProfileId","categoryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "space_community_profiles_spaceProfileId_key" ON "space_community_profiles"("spaceProfileId");

-- CreateIndex
CREATE INDEX "space_community_profiles_approvalStatus_idx" ON "space_community_profiles"("approvalStatus");

-- CreateIndex
CREATE INDEX "space_community_profile_categories_categoryId_idx" ON "space_community_profile_categories"("categoryId");

-- AddForeignKey
ALTER TABLE "space_community_profiles" ADD CONSTRAINT "space_community_profiles_spaceProfileId_fkey" FOREIGN KEY ("spaceProfileId") REFERENCES "space_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_community_profiles" ADD CONSTRAINT "space_community_profiles_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_community_profile_categories" ADD CONSTRAINT "space_community_profile_categories_spaceCommunityProfileId_fkey" FOREIGN KEY ("spaceCommunityProfileId") REFERENCES "space_community_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_community_profile_categories" ADD CONSTRAINT "space_community_profile_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
