/**
 * One-off backfill for the community member directory activity counters.
 *
 * Populates CommunityMember.{messageCount, eventsAttendedCount, lastActivityAt, activityScore}
 * from existing chat + attendance history. Set-based and idempotent — safe to re-run.
 *
 *   messageCount        ← non-deleted channel messages sent in the community
 *   eventsAttendedCount ← distinct community events the member has a CONFIRMED order for
 *                         (via OrderAttendee.userId — counts guests too, matching DM/graph logic)
 *   lastActivityAt      ← latest message time, falling back to joinedAt
 *   activityScore       ← messageCount * 1 + eventsAttendedCount * 5
 *
 * Run: npm run script:member-activity-backfill
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('— Step 1: messageCount + lastActivityAt from channel messages…');
  const msg = await prisma.$executeRaw`
    UPDATE community_members cm
    SET "messageCount" = sub.cnt,
        "lastActivityAt" = sub.last_at
    FROM (
      SELECT "communityId", "senderId" AS uid, COUNT(*)::int AS cnt, MAX("createdAt") AS last_at
      FROM channel_messages
      WHERE "deletedAt" IS NULL
      GROUP BY "communityId", "senderId"
    ) sub
    WHERE cm."communityId" = sub."communityId" AND cm."userId" = sub.uid
  `;
  console.log(`  updated ${msg} member row(s) with message activity`);

  console.log('— Step 2: eventsAttendedCount from confirmed orders…');
  const events = await prisma.$executeRaw`
    UPDATE community_members cm
    SET "eventsAttendedCount" = sub.cnt
    FROM (
      SELECT ce."communityId", oa."userId" AS uid, COUNT(DISTINCT o."eventId")::int AS cnt
      FROM order_attendees oa
      JOIN order_items oi ON oi.id = oa."orderItemId"
      JOIN orders o ON o.id = oi."orderId"
      JOIN community_events ce ON ce."eventId" = o."eventId"
      WHERE o.status = 'CONFIRMED' AND oa."userId" IS NOT NULL
      GROUP BY ce."communityId", oa."userId"
    ) sub
    WHERE cm."communityId" = sub."communityId" AND cm."userId" = sub.uid
  `;
  console.log(`  updated ${events} member row(s) with attendance`);

  console.log('— Step 3: lastActivityAt fallback to joinedAt…');
  const fallback = await prisma.$executeRaw`
    UPDATE community_members
    SET "lastActivityAt" = "joinedAt"
    WHERE "lastActivityAt" IS NULL AND "joinedAt" IS NOT NULL
  `;
  console.log(`  set ${fallback} fallback timestamp(s)`);

  console.log('— Step 4: activityScore = messageCount + eventsAttendedCount*5…');
  const score = await prisma.$executeRaw`
    UPDATE community_members
    SET "activityScore" = "messageCount" * 1 + "eventsAttendedCount" * 5
  `;
  console.log(`  scored ${score} member row(s)`);

  console.log('Backfill complete.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
