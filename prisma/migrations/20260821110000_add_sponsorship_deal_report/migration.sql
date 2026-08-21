-- CreateTable
CREATE TABLE "sponsorship_deal_reports" (
    "id" TEXT NOT NULL,
    "sponsorshipDealId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "proofKeys" TEXT[],
    "notes" TEXT,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsorship_deal_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sponsorship_deal_reports_sponsorshipDealId_key" ON "sponsorship_deal_reports"("sponsorshipDealId");

-- AddForeignKey
ALTER TABLE "sponsorship_deal_reports" ADD CONSTRAINT "sponsorship_deal_reports_sponsorshipDealId_fkey" FOREIGN KEY ("sponsorshipDealId") REFERENCES "sponsorship_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsorship_deal_reports" ADD CONSTRAINT "sponsorship_deal_reports_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
