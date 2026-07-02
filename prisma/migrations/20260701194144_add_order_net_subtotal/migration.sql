-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "netSubtotal" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Backfill existing rows: netSubtotal = subtotal - discountAmount
UPDATE "orders" SET "netSubtotal" = subtotal - "discountAmount";
