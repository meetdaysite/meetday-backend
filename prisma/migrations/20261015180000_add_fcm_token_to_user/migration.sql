-- Add fcmToken field to User model for push notifications
ALTER TABLE "users" ADD COLUMN "fcmToken" TEXT;
