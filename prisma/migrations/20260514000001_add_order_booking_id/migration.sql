ALTER TABLE "orders" ADD COLUMN "bookingId" TEXT NOT NULL DEFAULT '';
UPDATE "orders" SET "bookingId" = 'MDAY-' || upper(substring(md5(random()::text), 1, 4)) || '-' || upper(substring(md5(random()::text), 1, 4)) WHERE "bookingId" = '';
ALTER TABLE "orders" ALTER COLUMN "bookingId" DROP DEFAULT;
CREATE UNIQUE INDEX "orders_bookingId_key" ON "orders"("bookingId");
