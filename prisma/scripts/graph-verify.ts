/**
 * Dev verification for the social graph edge computation.
 *
 * Seeds 3 attendees + 1 host + 2 past events with a group booking and partial
 * check-ins, runs the scoped edge recompute twice (idempotency check), asserts
 * the counters/weights, then cleans everything up.
 *
 * Run: npx ts-node -r tsconfig-paths/register prisma/scripts/graph-verify.ts
 */
import { PrismaClient } from '@prisma/client';
import { GRAPH_WEIGHTS } from '../../src/modules/graph/graph.constants';
import { edgeRecomputeSql } from '../../src/modules/graph/graph.sql';

const prisma = new PrismaClient();
const TAG = 'graphverify';

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!ok) failures++;
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { firebaseUid: { startsWith: TAG } },
    select: { id: true, hostProfile: { select: { id: true } } },
  });
  const userIds = users.map((u) => u.id);
  const hostProfileIds = users.map((u) => u.hostProfile?.id).filter((id): id is string => !!id);

  if (hostProfileIds.length) {
    const events = await prisma.event.findMany({
      where: { hostProfileId: { in: hostProfileIds } },
      select: { id: true },
    });
    const eventIds = events.map((e) => e.id);
    await prisma.order.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }
  // user_connections cascade with users
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main() {
  await cleanup(); // clear leftovers from previous aborted runs

  const userRole = await prisma.role.findUniqueOrThrow({ where: { name: 'USER' } });
  const hostRole = await prisma.role.findFirst({ where: { name: 'HOST' } });

  console.log('— Seeding test data…');
  const [a, b, c, h] = await Promise.all(
    ['a', 'b', 'c', 'h'].map((suffix) =>
      prisma.user.create({
        data: {
          firebaseUid: `${TAG}-${suffix}`,
          email: `${TAG}-${suffix}@example.com`,
          firstName: suffix.toUpperCase(),
          lastName: 'Test',
          roleId: suffix === 'h' && hostRole ? hostRole.id : userRole.id,
        },
      }),
    ),
  );

  const hostProfile = await prisma.hostProfile.create({
    data: { userId: h.id, displayName: 'Graph Verify Host' },
  });

  async function createEvent(daysPast: number, title: string) {
    return prisma.event.create({
      data: {
        hostProfileId: hostProfile.id,
        title,
        status: 'PUBLISHED',
        eventDate: daysAgo(daysPast),
        tickets: { create: { name: 'GA', price: 100, totalCapacity: 100 } },
      },
      include: { tickets: true },
    });
  }

  async function createOrder(
    eventId: string,
    ticketId: string,
    buyerId: string,
    attendees: { userId: string; checkedIn: boolean }[],
  ) {
    return prisma.order.create({
      data: {
        bookingId: `MDAY-${TAG}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        userId: buyerId,
        eventId,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        subtotal: 100,
        platformFee: 0,
        taxAmount: 0,
        totalAmount: 100,
        items: {
          create: {
            ticketId,
            quantity: attendees.length,
            unitPrice: 100,
            attendees: {
              create: attendees.map((att, i) => ({
                fullName: `Attendee ${i}`,
                email: `${TAG}-${att.userId.slice(0, 6)}@example.com`,
                isLead: att.userId === buyerId,
                userId: att.userId,
                checkedInAt: att.checkedIn ? new Date() : null,
              })),
            },
          },
        },
      },
    });
  }

  // E1: A+B group booking (both checked in), C separate (checked in)
  const e1 = await createEvent(10, `${TAG} event 1`);
  await createOrder(e1.id, e1.tickets[0].id, a.id, [
    { userId: a.id, checkedIn: true },
    { userId: b.id, checkedIn: true },
  ]);
  await createOrder(e1.id, e1.tickets[0].id, c.id, [{ userId: c.id, checkedIn: true }]);

  // E2: A, B, C separate orders; A+B checked in, C no-show
  const e2 = await createEvent(5, `${TAG} event 2`);
  await createOrder(e2.id, e2.tickets[0].id, a.id, [{ userId: a.id, checkedIn: true }]);
  await createOrder(e2.id, e2.tickets[0].id, b.id, [{ userId: b.id, checkedIn: true }]);
  await createOrder(e2.id, e2.tickets[0].id, c.id, [{ userId: c.id, checkedIn: false }]);

  console.log('— Running scoped edge recompute (twice — idempotency check)…');
  const ids = [a.id, b.id, c.id];
  await prisma.$executeRaw(edgeRecomputeSql(ids));
  await prisma.$executeRaw(edgeRecomputeSql(ids));

  const edges = await prisma.userConnection.findMany({
    where: { userAId: { in: ids }, userBId: { in: ids } },
  });
  check('edge count', edges.length, 3);

  const edge = (x: string, y: string) =>
    edges.find(
      (e) =>
        (e.userAId === x && e.userBId === y) || (e.userAId === y && e.userBId === x),
    );

  const W = GRAPH_WEIGHTS;
  const ab = edge(a.id, b.id)!;
  console.log('— A↔B (group booking, both verified twice):');
  check('coAttendCount', ab.coAttendCount, 2);
  check('verifiedCoAttendCount', ab.verifiedCoAttendCount, 2);
  check('groupBookingCount', ab.groupBookingCount, 1);
  check('sharedHostCount', ab.sharedHostCount, 1);
  check('weight', ab.weight, 2 * W.CO_ATTEND + 2 * W.VERIFIED_CO_ATTEND + 1 * W.GROUP_BOOKING);

  const ac = edge(a.id, c.id)!;
  console.log('— A↔C (verified once — C no-showed E2):');
  check('coAttendCount', ac.coAttendCount, 2);
  check('verifiedCoAttendCount', ac.verifiedCoAttendCount, 1);
  check('groupBookingCount', ac.groupBookingCount, 0);
  check('weight', ac.weight, 2 * W.CO_ATTEND + 1 * W.VERIFIED_CO_ATTEND);

  const bc = edge(b.id, c.id)!;
  console.log('— B↔C (mirror of A↔C):');
  check('coAttendCount', bc.coAttendCount, 2);
  check('verifiedCoAttendCount', bc.verifiedCoAttendCount, 1);
  check('weight', bc.weight, 2 * W.CO_ATTEND + 1 * W.VERIFIED_CO_ATTEND);

  console.log('— Cleaning up…');
  await cleanup();

  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log('All checks passed.');
  }
}

main()
  .catch((err) => {
    console.error('Verification failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
