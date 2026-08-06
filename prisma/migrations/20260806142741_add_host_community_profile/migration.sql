-- CreateTable
CREATE TABLE "host_community_profiles" (
    "id" TEXT NOT NULL,
    "hostProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "about" TEXT NOT NULL,
    "logoKey" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "avgGuestCount" TEXT NOT NULL,
    "experiencesPerYear" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_community_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_community_profile_categories" (
    "hostCommunityProfileId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "host_community_profile_categories_pkey" PRIMARY KEY ("hostCommunityProfileId","categoryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "host_community_profiles_hostProfileId_key" ON "host_community_profiles"("hostProfileId");

-- CreateIndex
CREATE INDEX "host_community_profile_categories_categoryId_idx" ON "host_community_profile_categories"("categoryId");

-- AddForeignKey
ALTER TABLE "host_community_profiles" ADD CONSTRAINT "host_community_profiles_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_community_profile_categories" ADD CONSTRAINT "host_community_profile_categories_hostCommunityProfileId_fkey" FOREIGN KEY ("hostCommunityProfileId") REFERENCES "host_community_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_community_profile_categories" ADD CONSTRAINT "host_community_profile_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
