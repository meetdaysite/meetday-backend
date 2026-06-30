-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "hostFeePromoId" TEXT;

-- CreateTable
CREATE TABLE "platform_configs" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "host_fee_promos" (
    "id" TEXT NOT NULL,
    "hostProfileId" TEXT NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "maxEvents" INTEGER,
    "eventsApplied" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_fee_promos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_fee_promo_usages" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_fee_promo_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "host_fee_promos_hostProfileId_idx" ON "host_fee_promos"("hostProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "host_fee_promo_usages_promoId_eventId_key" ON "host_fee_promo_usages"("promoId", "eventId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_hostFeePromoId_fkey" FOREIGN KEY ("hostFeePromoId") REFERENCES "host_fee_promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_fee_promos" ADD CONSTRAINT "host_fee_promos_hostProfileId_fkey" FOREIGN KEY ("hostProfileId") REFERENCES "host_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_fee_promo_usages" ADD CONSTRAINT "host_fee_promo_usages_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "host_fee_promos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_fee_promo_usages" ADD CONSTRAINT "host_fee_promo_usages_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
