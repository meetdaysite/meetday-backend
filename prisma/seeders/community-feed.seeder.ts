/**
 * Seeds the community feed with realistic posts + engagement so the attendee
 * Feed tab and the admin Overview (Posts / Reactions / Comments / Reach / Popular /
 * Trending) have data. Idempotent — a community with existing posts is skipped.
 *
 * To give posts an audience, each community's active-member pool is topped up to
 * ~6 by enrolling a few existing users (recent joinedAt → also feeds the
 * "new members" + reach sparklines). Run: npm run script:community-feed-seed
 */
import { FeedPostCategory, FeedPostType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const EMOJIS = ['❤️', '🔥', '🙌', '😍'];
const COMMENTS = [
  'This is amazing! 🙌',
  'Count me in for the next one!',
  'Loved every bit of it.',
  'Wish I could have made it 😅',
  'Great shots!',
  'See you there!',
];
const GENERIC_TOPICS = ['Best Rooftop Spots', 'Event Recommendations', 'After Hours'];
const POOL_TARGET = 6;

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

async function main() {
  console.log('\n[Community Feed]');

  const candidates = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true },
    take: 60,
  });

  const communities = await prisma.community.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });

  let createdPosts = 0;
  let skipped = 0;

  for (const community of communities) {
    const already = await prisma.communityPost.findFirst({
      where: { communityId: community.id },
      select: { id: true },
    });
    if (already) {
      console.log(`  SKIP      ${community.name}`);
      skipped++;
      continue;
    }

    // Build an engager pool of ~6 active members (top up with existing users).
    const existing = await prisma.communityMember.findMany({
      where: { communityId: community.id, status: 'ACTIVE' },
      select: { userId: true },
    });
    const pool = existing.map((m) => m.userId);
    const have = new Set(pool);
    for (const c of candidates) {
      if (pool.length >= POOL_TARGET) break;
      if (have.has(c.id)) continue;
      await prisma.communityMember.upsert({
        where: { communityId_userId: { communityId: community.id, userId: c.id } },
        create: {
          communityId: community.id,
          userId: c.id,
          role: 'MEMBER',
          status: 'ACTIVE',
          joinedAt: new Date(Date.now() - Math.floor(Math.random() * 10) * DAY),
          lastActivityAt: new Date(),
        },
        update: {},
      });
      pool.push(c.id);
      have.add(c.id);
    }
    if (pool.length === 0) {
      console.log(`  SKIP      ${community.name} (no users)`);
      skipped++;
      continue;
    }

    const events = await prisma.communityEvent.findMany({
      where: { communityId: community.id },
      select: { event: { select: { title: true } } },
      take: 3,
    });
    const eventTitles = events.map((e) => e.event.title).filter((t): t is string => !!t);
    const topics = [...eventTitles, ...GENERIC_TOPICS];
    const e0 = eventTitles[0] ?? 'our last event';
    const e1 = eventTitles[1] ?? 'the next one';

    const defs: {
      category: FeedPostCategory;
      postType: FeedPostType;
      topic: string;
      content: string;
      ageMs: number;
      pollOptions?: string[];
    }[] = [
      { category: 'MEMORIES', postType: 'TEXT', topic: pick(topics, 0), ageMs: 6 * HOUR,
        content: `What a night at ${e0}! The energy, the music, the people — everything was unreal. Already excited for the next one ✨` },
      { category: 'RECOMMENDATION', postType: 'TEXT', topic: 'Best Rooftop Spots', ageMs: 1 * DAY,
        content: `Any recommendations for good spots near the venue before ${e1}?` },
      { category: 'QUESTION', postType: 'TEXT', topic: 'Event Recommendations', ageMs: 2 * DAY,
        content: `Anyone else going to ${e1} this weekend? Would love to meet up before the event! 🎵` },
      { category: 'GENERAL', postType: 'TEXT', topic: pick(topics, 1), ageMs: 4 * DAY,
        content: `Loved the vibe of ${community.name}. So glad I joined this community 🙌` },
      { category: 'POLL', postType: 'POLL', topic: pick(topics, 0), ageMs: 5 * DAY,
        content: `Which experience was your favorite so far?`,
        pollOptions: [e0, e1, 'Both were 🔥'] },
    ];

    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      const authorId = pick(pool, i);
      const createdAt = new Date(Date.now() - def.ageMs);

      const reactors = pool.filter((u) => u !== authorId).slice(0, 3);
      const commenters = pool.filter((u) => u !== authorId).slice(0, 2);
      const viewers = pool; // everyone "saw" it
      const sharers = pool.filter((u) => u !== authorId).slice(0, 1);

      const post = await prisma.communityPost.create({
        data: {
          communityId: community.id,
          authorId,
          postType: def.postType,
          category: def.category,
          topic: def.topic,
          content: def.content,
          createdAt,
          reactionCount: reactors.length,
          commentCount: commenters.length,
          shareCount: sharers.length,
          viewCount: viewers.length,
          ...(def.pollOptions
            ? { pollOptions: { create: def.pollOptions.map((text, p) => ({ text, position: p })) } }
            : {}),
        },
        include: { pollOptions: true },
      });

      await Promise.all([
        prisma.communityPostReaction.createMany({
          data: reactors.map((uid, r) => ({ postId: post.id, userId: uid, emoji: pick(EMOJIS, r) })),
          skipDuplicates: true,
        }),
        prisma.communityPostComment.createMany({
          data: commenters.map((uid, c) => ({ postId: post.id, authorId: uid, content: pick(COMMENTS, i + c) })),
        }),
        prisma.communityPostView.createMany({
          data: viewers.map((uid) => ({ postId: post.id, communityId: community.id, userId: uid })),
          skipDuplicates: true,
        }),
        prisma.communityPostShare.createMany({
          data: sharers.map((uid) => ({ postId: post.id, userId: uid })),
          skipDuplicates: true,
        }),
      ]);

      // Poll votes — distribute the pool across options.
      if (post.pollOptions.length) {
        const votes = pool.map((uid, v) => ({
          postId: post.id,
          optionId: post.pollOptions[v % post.pollOptions.length].id,
          userId: uid,
        }));
        await prisma.communityPostPollVote.createMany({ data: votes, skipDuplicates: true });
        for (let o = 0; o < post.pollOptions.length; o++) {
          const count = votes.filter((vt) => vt.optionId === post.pollOptions[o].id).length;
          if (count) {
            await prisma.communityPostPollOption.update({
              where: { id: post.pollOptions[o].id },
              data: { voteCount: count },
            });
          }
        }
      }

      createdPosts++;
    }

    // Keep the denormalized member count in sync after topping up the pool.
    const memberCount = await prisma.communityMember.count({
      where: { communityId: community.id, status: 'ACTIVE' },
    });
    await prisma.community.update({ where: { id: community.id }, data: { memberCount } });

    console.log(`  CREATED   ${defs.length} posts for "${community.name}" (pool ${pool.length})`);
  }

  console.log(`  → ${createdPosts} posts created, ${skipped} communities skipped`);
}

main()
  .catch((err) => {
    console.error('Feed seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
