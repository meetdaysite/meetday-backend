-- Deduplicate: keep only the most-recent reaction per (messageId, userId)
-- before tightening the unique constraint from 3-column to 2-column.
DELETE FROM "message_reactions" a
USING "message_reactions" b
WHERE a."messageId" = b."messageId"
  AND a."userId" = b."userId"
  AND a."createdAt" < b."createdAt";

-- Drop old 3-column unique index
DROP INDEX IF EXISTS "message_reactions_messageId_userId_emoji_key";

-- Add new 2-column unique constraint (one reaction per user per message)
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_messageId_userId_key"
  UNIQUE ("messageId", "userId");
