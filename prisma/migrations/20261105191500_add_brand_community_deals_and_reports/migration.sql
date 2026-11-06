-- CreateTable
CREATE TABLE "brand_community_collaboration_deals" (
    "id" TEXT NOT NULL,
    "collaborationInterestId" TEXT NOT NULL,
    "collaborationType" TEXT NOT NULL DEFAULT 'SPONSORSHIP',
    "projectName" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "time" TEXT,
    "sponsorshipCategory" TEXT,
    "sponsorshipAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "venue" TEXT NOT NULL,
    "barterElements" TEXT,
    "deliverables" TEXT NOT NULL,
    "otherTerms" TEXT,
    "additionalNotes" TEXT,
    "dealData" JSONB,
    "status" "SponsorshipDealStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "changeRequestNote" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_community_collaboration_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_community_collaboration_deal_reports" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "eventDate" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "time" TEXT,
    "guestCount" TEXT,
    "ageRange" TEXT,
    "deliverables" JSONB NOT NULL DEFAULT '[]',
    "videoLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "socialLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mediaKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "reportData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "revisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_community_collaboration_deal_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_community_collaboration_deals_collaborationInterestId_key" ON "brand_community_collaboration_deals"("collaborationInterestId");

-- CreateIndex
CREATE INDEX "brand_community_collaboration_deals_status_idx" ON "brand_community_collaboration_deals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "brand_community_collaboration_deal_reports_dealId_key" ON "brand_community_collaboration_deal_reports"("dealId");

-- AddForeignKey
ALTER TABLE "brand_community_collaboration_deals" ADD CONSTRAINT "brand_community_collaboration_deals_collaborationInterestId_fkey" FOREIGN KEY ("collaborationInterestId") REFERENCES "brand_community_collaboration_interests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_community_collaboration_deals" ADD CONSTRAINT "brand_community_collaboration_deals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_community_collaboration_deal_reports" ADD CONSTRAINT "brand_community_collaboration_deal_reports_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "brand_community_collaboration_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
