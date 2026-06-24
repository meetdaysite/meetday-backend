-- CreateEnum
CREATE TYPE "FeedPostType" AS ENUM ('TEXT', 'PHOTO', 'POLL');

-- CreateEnum
CREATE TYPE "FeedPostCategory" AS ENUM ('GENERAL', 'MEMORIES', 'RECOMMENDATION', 'QUESTION', 'POLL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'FEED_POST_DELETED_BY_MOD';
ALTER TYPE "AuditAction" ADD VALUE 'FEED_POST_PINNED';
ALTER TYPE "AuditAction" ADD VALUE 'FEED_POST_UNPINNED';

-- CreateTable
CREATE TABLE "community_posts" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "postType" "FeedPostType" NOT NULL DEFAULT 'TEXT',
    "category" "FeedPostCategory" NOT NULL DEFAULT 'GENERAL',
    "topic" TEXT,
    "eventId" TEXT,
    "content" TEXT NOT NULL,
    "mediaKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "bookmarkCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_poll_options" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "voteCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "community_post_poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_poll_votes" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_bookmarks" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_comments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_reactions" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_shares" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_views" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_posts_communityId_isPinned_createdAt_idx" ON "community_posts"("communityId", "isPinned", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "community_posts_communityId_createdAt_idx" ON "community_posts"("communityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "community_posts_communityId_topic_createdAt_idx" ON "community_posts"("communityId", "topic", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "community_post_poll_options_postId_idx" ON "community_post_poll_options"("postId");

-- CreateIndex
CREATE INDEX "community_post_poll_votes_optionId_idx" ON "community_post_poll_votes"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "community_post_poll_votes_postId_userId_key" ON "community_post_poll_votes"("postId", "userId");

-- CreateIndex
CREATE INDEX "community_post_bookmarks_userId_idx" ON "community_post_bookmarks"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "community_post_bookmarks_postId_userId_key" ON "community_post_bookmarks"("postId", "userId");

-- CreateIndex
CREATE INDEX "community_post_comments_postId_createdAt_idx" ON "community_post_comments"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "community_post_reactions_postId_idx" ON "community_post_reactions"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "community_post_reactions_postId_userId_emoji_key" ON "community_post_reactions"("postId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "community_post_shares_postId_idx" ON "community_post_shares"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "community_post_shares_postId_userId_key" ON "community_post_shares"("postId", "userId");

-- CreateIndex
CREATE INDEX "community_post_views_communityId_viewedAt_idx" ON "community_post_views"("communityId", "viewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "community_post_views_postId_userId_key" ON "community_post_views"("postId", "userId");

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_poll_options" ADD CONSTRAINT "community_post_poll_options_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_poll_votes" ADD CONSTRAINT "community_post_poll_votes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_poll_votes" ADD CONSTRAINT "community_post_poll_votes_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "community_post_poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_poll_votes" ADD CONSTRAINT "community_post_poll_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_bookmarks" ADD CONSTRAINT "community_post_bookmarks_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_bookmarks" ADD CONSTRAINT "community_post_bookmarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_comments" ADD CONSTRAINT "community_post_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_comments" ADD CONSTRAINT "community_post_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_reactions" ADD CONSTRAINT "community_post_reactions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_reactions" ADD CONSTRAINT "community_post_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_shares" ADD CONSTRAINT "community_post_shares_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_shares" ADD CONSTRAINT "community_post_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_views" ADD CONSTRAINT "community_post_views_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_views" ADD CONSTRAINT "community_post_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
