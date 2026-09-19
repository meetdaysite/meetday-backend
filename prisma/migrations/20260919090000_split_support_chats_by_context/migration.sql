-- Keep support conversations separate when one User owns both a Community and a Hub account.
DO $$
BEGIN
  CREATE TYPE "MeetdayChatContext" AS ENUM ('HOST', 'BRAND', 'SPACE_PARTNER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "meetday_chat_threads"
  ADD COLUMN "context" "MeetdayChatContext" NOT NULL DEFAULT 'HOST';

-- Existing threads historically represented the host/community account. Create a fresh
-- Hub-scoped thread for users that also have a Space Partner profile; old history remains
-- with the Community thread instead of being shown in the Hub support chat.
INSERT INTO "meetday_chat_threads" ("id", "userId", "context", "createdAt", "lastMessageAt", "userLastReadAt", "adminLastReadAt", "botDormant")
SELECT gen_random_uuid(), t."userId", 'SPACE_PARTNER', now(), NULL, NULL, NULL, false
FROM "meetday_chat_threads" t
JOIN "space_profiles" sp ON sp."userId" = t."userId"
WHERE t."context" = 'HOST';

CREATE UNIQUE INDEX "meetday_chat_threads_userId_context_key"
  ON "meetday_chat_threads" ("userId", "context");

