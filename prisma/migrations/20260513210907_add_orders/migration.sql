-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'REFUNDED');

-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "eventId" TEXT;

-- AlterTable
ALTER TABLE "event_tickets" ADD COLUMN     "soldCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "subtotal" DECIMAL(65,30) NOT NULL,
    "platformFee" DECIMAL(65,30) NOT NULL,
    "taxAmount" DECIMAL(65,30) NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "couponId" TEXT,
    "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_attendees" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "ticketCode" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3),

    CONSTRAINT "order_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_razorpayOrderId_key" ON "orders"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_razorpayPaymentId_key" ON "orders"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "orders_userId_idx" ON "orders"("userId");

-- CreateIndex
CREATE INDEX "orders_eventId_idx" ON "orders"("eventId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_couponId_idx" ON "orders"("couponId");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_ticketId_idx" ON "order_items"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "order_attendees_ticketCode_key" ON "order_attendees"("ticketCode");

-- CreateIndex
CREATE INDEX "order_attendees_orderItemId_idx" ON "order_attendees"("orderItemId");

-- CreateIndex
CREATE INDEX "order_attendees_ticketCode_idx" ON "order_attendees"("ticketCode");

-- CreateIndex
CREATE INDEX "coupons_eventId_idx" ON "coupons"("eventId");

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "event_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_attendees" ADD CONSTRAINT "order_attendees_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
