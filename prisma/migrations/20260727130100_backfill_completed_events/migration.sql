-- Backfill: mark already-ended published events as COMPLETED.
-- Strictly-before-today guarantees the event has ended even accounting for end-of-day; events
-- ending *today* are intentionally left for the completion cron to flip once their endTime passes,
-- so a not-yet-ended event today is never prematurely marked completed.
UPDATE "events"
SET "status" = 'COMPLETED'
WHERE "status" = 'PUBLISHED'
  AND COALESCE("endDate", "eventDate") < CURRENT_DATE;
