-- Add BOT as a valid sender type for the "Talk to Meetday" support chat.
ALTER TYPE "MeetdayChatSenderType" ADD VALUE 'BOT';

-- BOT messages are auto-generated and have no real User to attribute to.
ALTER TABLE "meetday_chat_messages" ALTER COLUMN "senderId" DROP NOT NULL;
