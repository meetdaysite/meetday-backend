import { AnnouncementCategory, PrismaClient } from '@prisma/client';

interface SeedAnnouncement {
  category: AnnouncementCategory;
  title: string;
  body: string;
  isPinned: boolean;
  publishedAt: Date;
  likeCount: number;
  bookmarkCount: number;
}

interface LinkedEvent {
  title: string | null;
  eventDate: Date | null;
  venueName: string | null;
  city: string | null;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** e.g. "Fri, 24 May • 8:00 PM" */
function formatEventWhen(date: Date | null): string | null {
  if (!date) return null;
  const day = date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} • ${time}`;
}

function locationLine(e: LinkedEvent): string {
  return [e.venueName, e.city].filter(Boolean).join(', ');
}

/** Build 3 announcements tailored to a single community's own data. */
function buildAnnouncements(
  community: { name: string; primaryCity: string | null; interestTags: string[] },
  events: LinkedEvent[],
): SeedAnnouncement[] {
  const now = Date.now();
  const city = community.primaryCity ?? 'your city';
  const e1 = events[0];
  const e2 = events[1] ?? events[0];

  // 1 — EVENT_DROP (pinned)
  const drop: SeedAnnouncement =
    e1 && e1.title
      ? {
          category: AnnouncementCategory.EVENT_DROP,
          title: `${e1.title} — Early Access is Live!`,
          body: [
            `Members get first dibs on ${e1.title}.`,
            formatEventWhen(e1.eventDate) ? `Happening ${formatEventWhen(e1.eventDate)}.` : '',
            locationLine(e1) ? `📍 ${locationLine(e1)}` : '',
            'Grab your spot before it opens to everyone.',
          ]
            .filter(Boolean)
            .join(' '),
          isPinned: true,
          publishedAt: new Date(now),
          likeCount: 45,
          bookmarkCount: 6,
        }
      : {
          category: AnnouncementCategory.EVENT_DROP,
          title: `New Experiences Dropping in ${community.name}`,
          body: `Fresh experiences are landing in ${city} soon. Keep an eye on this space — members hear about them first.`,
          isPinned: true,
          publishedAt: new Date(now),
          likeCount: 45,
          bookmarkCount: 6,
        };

  // 2 — EVENT_REMINDER
  const reminder: SeedAnnouncement =
    e2 && e2.title
      ? {
          category: AnnouncementCategory.EVENT_REMINDER,
          title: `${e2.title} is Coming Up!`,
          body: [
            formatEventWhen(e2.eventDate) ? `${e2.title} is on ${formatEventWhen(e2.eventDate)}.` : `${e2.title} is almost here.`,
            locationLine(e2) ? `See you at ${locationLine(e2)}.` : '',
            "Don't forget to bring a valid ID.",
          ]
            .filter(Boolean)
            .join(' '),
          isPinned: false,
          publishedAt: new Date(now - 3 * HOUR),
          likeCount: 32,
          bookmarkCount: 3,
        }
      : {
          category: AnnouncementCategory.EVENT_REMINDER,
          title: `Plan Your Week with ${community.name}`,
          body: `We've got experiences lining up across ${city}. Check the Experiences tab and RSVP early — spots fill fast.`,
          isPinned: false,
          publishedAt: new Date(now - 3 * HOUR),
          likeCount: 32,
          bookmarkCount: 3,
        };

  // 3 — COMMUNITY_UPDATE
  const tags = community.interestTags.slice(0, 3);
  const tagLine =
    tags.length > 0
      ? `This is your space for ${tags.join(', ')} and everything in between.`
      : 'This is your space to connect with people who share your vibe.';
  const update: SeedAnnouncement = {
    category: AnnouncementCategory.COMMUNITY_UPDATE,
    title: `Welcome to ${community.name}!`,
    body: `${tagLine} Introduce yourself in Chat, RSVP to upcoming experiences${community.primaryCity ? ` around ${community.primaryCity}` : ''}, and say hi to fellow members.`,
    isPinned: false,
    publishedAt: new Date(now - 2 * DAY),
    likeCount: 28,
    bookmarkCount: 9,
  };

  return [drop, reminder, update];
}

export async function seedCommunityAnnouncements(prisma: PrismaClient): Promise<void> {
  console.log('\n[Community Announcements]');

  // Author — prefer the super admin (Meetday-managed); fall back to the demo host.
  const author =
    (await prisma.user.findFirst({
      where: { role: { name: 'SUPER_ADMIN' } },
      select: { id: true, email: true },
    })) ??
    (await prisma.user.findUnique({
      where: { firebaseUid: 'seed-demo-host-001' },
      select: { id: true, email: true },
    }));

  if (!author) {
    throw new Error('No SUPER_ADMIN or demo host user found — run the earlier seeders first');
  }
  console.log(`  Author    ${author.email}`);

  const communities = await prisma.community.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, primaryCity: true, interestTags: true },
  });

  let created = 0;
  let skipped = 0;

  for (const community of communities) {
    const already = await prisma.communityAnnouncement.findFirst({
      where: { communityId: community.id, deletedAt: null },
      select: { id: true },
    });
    if (already) {
      console.log(`  SKIP      ${community.name}`);
      skipped++;
      continue;
    }

    // Pull up to 2 linked events, preferring upcoming ones.
    const now = new Date();
    const upcoming = await prisma.communityEvent.findMany({
      where: { communityId: community.id, event: { eventDate: { gte: now } } },
      select: { event: { select: { title: true, eventDate: true, venueName: true, city: true } } },
      orderBy: { event: { eventDate: 'asc' } },
      take: 2,
    });
    const fallback =
      upcoming.length > 0
        ? []
        : await prisma.communityEvent.findMany({
            where: { communityId: community.id },
            select: { event: { select: { title: true, eventDate: true, venueName: true, city: true } } },
            orderBy: { event: { eventDate: 'desc' } },
            take: 2,
          });
    const events: LinkedEvent[] = [...upcoming, ...fallback].map((ce) => ce.event);

    const announcements = buildAnnouncements(community, events);
    await prisma.communityAnnouncement.createMany({
      data: announcements.map((a) => ({
        communityId: community.id,
        authorId: author.id,
        authorRole: 'ADMIN',
        category: a.category,
        title: a.title,
        body: a.body,
        imageKey: null,
        isPinned: a.isPinned,
        pinnedAt: a.isPinned ? a.publishedAt : null,
        publishedAt: a.publishedAt,
        likeCount: a.likeCount,
        bookmarkCount: a.bookmarkCount,
      })),
    });

    console.log(`  CREATED   ${announcements.length} for "${community.name}"`);
    created += announcements.length;
  }

  console.log(`  → ${created} created, ${skipped} skipped`);
}
