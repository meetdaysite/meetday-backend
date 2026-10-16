-- Add editedAt to community collaboration messages
ALTER TABLE "community_collaboration_messages" ADD COLUMN "editedAt" TIMESTAMP(3);

-- Add editedAt to brand community collaboration messages
ALTER TABLE "brand_community_collaboration_messages" ADD COLUMN "editedAt" TIMESTAMP(3);
