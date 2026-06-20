/**
 * One-off backfill for the IRL social graph.
 *
 * 1. Resolves OrderAttendee.userId for historical orders:
 *    - lead attendees ← the order's buyer
 *    - group attendees ← users matched by email
 * 2. Recomputes every UserConnection edge from full confirmed-order history
 *    (set-based, idempotent — same formula as GraphService).
 * 3. Marks all settled events as graph-processed so the hourly cron doesn't
 *    re-process them and fire crossed-paths nudges for historical events.
 *
 * Run: npm run script:graph-backfill
 */
import { PrismaClient } from '@prisma/client';
import { EVENT_SETTLE_HOURS } from '../../src/modules/graph/graph.constants';
import { edgeRecomputeSql } from '../../src/modules/graph/graph.sql';

const prisma = new PrismaClient();

async function main() {
  console.log('— Step 1a: resolving lead attendees to buyers…');
  const leads = await prisma.$executeRaw`
    UPDATE order_attendees oa
    SET "userId" = o."userId"
    FROM order_items oi
    JOIN orders o ON o.id = oi."orderId"
    WHERE oa."orderItemId" = oi.id
      AND oa."isLead" = true
      AND oa."userId" IS NULL
  `;
  console.log(`  resolved ${leads} lead attendee row(s)`);

  console.log('— Step 1b: resolving group attendees by email…');
  const byEmail = await prisma.$executeRaw`
    UPDATE order_attendees oa
    SET "userId" = u.id
    FROM users u
    WHERE oa."userId" IS NULL
      AND u.email = oa.email
      AND u."deletedAt" IS NULL
  `;
  console.log(`  resolved ${byEmail} group attendee row(s)`);

  console.log('— Step 2: recomputing all edges from history…');
  const edges = await prisma.$executeRaw(edgeRecomputeSql());
  console.log(`  upserted ${edges} edge(s)`);

  console.log('— Step 3: marking settled events as graph-processed…');
  const settleCutoff = new Date(Date.now() - EVENT_SETTLE_HOURS * 60 * 60 * 1000);
  const marked = await prisma.event.updateMany({
    where: { status: 'PUBLISHED', eventDate: { lt: settleCutoff }, graphProcessedAt: null },
    data: { graphProcessedAt: new Date() },
  });
  console.log(`  marked ${marked.count} event(s)`);

  console.log('Backfill complete.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
