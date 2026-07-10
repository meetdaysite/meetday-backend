-- CreateEnum
CREATE TYPE "CouponTarget" AS ENUM ('HOST', 'ATTENDEE', 'VENDOR');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FLAT');

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "target" "CouponTarget" NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "maxUsages" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "maxUsagesPerUser" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hostSubscriptionId" TEXT,
    "originalFeeRate" DOUBLE PRECISION NOT NULL,
    "discountedFeeRate" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_code_idx" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_target_isActive_idx" ON "coupons"("target", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_hostSubscriptionId_key" ON "coupon_redemptions"("hostSubscriptionId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_couponId_idx" ON "coupon_redemptions"("couponId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_userId_idx" ON "coupon_redemptions"("userId");

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_hostSubscriptionId_fkey" FOREIGN KEY ("hostSubscriptionId") REFERENCES "host_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
