-- AlterEnum
-- Postgres cannot add an enum value and use it in the same transaction, so the backfill
-- that references 'COMPLETED' lives in the next migration (20260727130100_backfill_completed_events).
ALTER TYPE "EventStatus" ADD VALUE 'COMPLETED';
