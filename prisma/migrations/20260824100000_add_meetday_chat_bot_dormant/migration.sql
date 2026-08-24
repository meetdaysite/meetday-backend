-- Tracks whether the support chatbot has handed off to a human (or a human has taken over)
-- for a given "Talk to Meetday" thread. Reset by admin's "Mark as Resolved" action.
ALTER TABLE "meetday_chat_threads" ADD COLUMN "botDormant" BOOLEAN NOT NULL DEFAULT false;
