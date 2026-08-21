-- Clear all sponsorship interests (cascades to messages and deals)
TRUNCATE TABLE sponsorship_interests CASCADE;

-- Clear all general Meetday support chat threads (cascades to messages)
TRUNCATE TABLE meetday_chat_threads CASCADE;
