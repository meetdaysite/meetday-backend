/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

const COVERS_DIR = path.join(__dirname, '..', 'seed-community-covers');
const ICONS_DIR = path.join(__dirname, '..', '..', 'interest-images');
const S3_SEED_PREFIX = 'seed/communities';

const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

// All communities share the same metro spread so auto-matching can pull in events
// across the cities seeded by event.seeder.ts.
const COMMUNITY_CITIES = ['Bangalore', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Chennai', 'Goa', 'Rishikesh'];

interface CommunitySeed {
  /** Interest taxonomy slug — drives the interest link, event matching, and image filenames. */
  interestSlug: string;
  /** Public URL slug for the community (derived from its name). */
  slug: string;
  name: string;
  description: string;
  primaryCity: string;
  tags: string[];
}

const COMMUNITIES: CommunitySeed[] = [
  {
    interestSlug: 'founders-huddle',
    slug: 'zero-to-one-club',
    name: 'Zero to One Club',
    description:
      'A home for early-stage founders to swap war stories, find collaborators, and meet the investors and operators building the next wave.',
    primaryCity: 'Bangalore',
    tags: ['Startups', 'Founders', 'Investing', 'Networking'],
  },
  {
    interestSlug: 'ai-future-tech',
    slug: 'the-singularity-society',
    name: 'The Singularity Society',
    description:
      'Where builders, researchers, and the AI-curious gather to explore what is next — from hands-on workshops to candid future-tech conversations.',
    primaryCity: 'Bangalore',
    tags: ['AI', 'Machine Learning', 'Future Tech'],
  },
  {
    interestSlug: 'career-pivot-lab',
    slug: 'second-act',
    name: 'Second Act',
    description:
      'For professionals reinventing their careers — masterclasses, mentorship, and a supportive crowd making bold moves together.',
    primaryCity: 'Mumbai',
    tags: ['Careers', 'Upskilling', 'Mentorship'],
  },
  {
    interestSlug: 'proptech-urban-design',
    slug: 'city-shapers',
    name: 'City Shapers',
    description:
      'A community for people shaping how cities are built and lived in — real estate, urban design, and the technology rewiring both.',
    primaryCity: 'Bangalore',
    tags: ['PropTech', 'Urban Design', 'Real Estate'],
  },
  {
    interestSlug: 'conscious-living',
    slug: 'the-slow-living-society',
    name: 'The Slow Living Society',
    description:
      'Mindful, sustainable, and intentional — meet people building lives and communities around conscious choices and good causes.',
    primaryCity: 'Pune',
    tags: ['Sustainability', 'Mindful Living', 'Causes'],
  },
  {
    interestSlug: 'sunrise-social',
    slug: 'daybreakers',
    name: 'Daybreakers',
    description:
      'Start the day with good people — early-morning meetups, rooftop coffees, and wellness rituals before the world wakes up.',
    primaryCity: 'Bangalore',
    tags: ['Mornings', 'Wellness', 'Outdoors'],
  },
  {
    interestSlug: 'weekend-trekker',
    slug: 'summit-seekers',
    name: 'Summit Seekers',
    description:
      'Trade the weekend slump for trails and summits. Group treks, hikes, and outdoor adventures for every level of explorer.',
    primaryCity: 'Pune',
    tags: ['Trekking', 'Hiking', 'Adventure'],
  },
  {
    interestSlug: 'padel-pickleball',
    slug: 'the-baseline-club',
    name: 'The Baseline Club',
    description:
      'The fastest-growing racquet sports community — find courts, partners, and friendly games whatever your level.',
    primaryCity: 'Hyderabad',
    tags: ['Padel', 'Pickleball', 'Racquet Sports'],
  },
  {
    interestSlug: 'pet-parents-social',
    slug: 'paws-and-people',
    name: 'Paws & People',
    description:
      'Wagging tails and good company — park meetups, playdates, and a friendly circle of fellow pet parents.',
    primaryCity: 'Bangalore',
    tags: ['Pets', 'Dog Parents', 'Meetups'],
  },
  {
    interestSlug: 'supper-club',
    slug: 'the-long-table',
    name: 'The Long Table',
    description:
      'Long tables, great food, and better conversation — intimate supper clubs, tastings, and dinners for the food-obsessed.',
    primaryCity: 'Mumbai',
    tags: ['Food', 'Wine', 'Supper Club'],
  },
  {
    interestSlug: 'urban-explorers-guild',
    slug: 'the-wanderers-guild',
    name: "The Wanderers' Guild",
    description:
      'Rediscover your city — heritage walks, hidden lanes, and curious explorations with people who love to wander.',
    primaryCity: 'Delhi',
    tags: ['City Walks', 'Exploration', 'Heritage'],
  },
  {
    interestSlug: 'modern-art-gallery-hops',
    slug: 'the-canvas-club',
    name: 'The Canvas Club',
    description:
      'For lovers of contemporary art — gallery hops, exhibition openings, and conversations with a culturally curious crowd.',
    primaryCity: 'Mumbai',
    tags: ['Art', 'Galleries', 'Culture'],
  },
  {
    interestSlug: 'documentary-discourse',
    slug: 'the-screening-room',
    name: 'The Screening Room',
    description:
      'Watch, think, discuss — documentary screenings and thoughtful conversations on the ideas shaping our world.',
    primaryCity: 'Bangalore',
    tags: ['Documentaries', 'Discussion', 'Ideas'],
  },
  {
    interestSlug: 'tactile-makerspace',
    slug: 'the-makers-bench',
    name: "The Maker's Bench",
    description:
      'Make things with your hands — woodworking, ceramics, craft, and hands-on workshops for the creatively restless.',
    primaryCity: 'Bangalore',
    tags: ['Making', 'Craft', 'Workshops'],
  },
  {
    interestSlug: 'strategic-board-gaming',
    slug: 'meeple-and-co',
    name: 'Meeple & Co.',
    description:
      'Dice, decks, and deep strategy — game nights and tournaments for tabletop enthusiasts who love a good challenge.',
    primaryCity: 'Hyderabad',
    tags: ['Board Games', 'Strategy', 'Tabletop'],
  },
  {
    interestSlug: 'wellness-mindfulness',
    slug: 'the-calm-collective',
    name: 'The Calm Collective',
    description:
      'Slow down and reconnect — meditation, yoga, and mindfulness gatherings for a calmer, more grounded life.',
    primaryCity: 'Goa',
    tags: ['Wellness', 'Meditation', 'Mindfulness'],
  },
  {
    interestSlug: 'creator-meetups',
    slug: 'off-camera',
    name: 'Off Camera',
    description:
      'Where content creators connect — collaborations, skill-shares, and a community that gets the creator grind.',
    primaryCity: 'Bangalore',
    tags: ['Creators', 'Content', 'Community'],
  },
];

async function uploadImage(
  s3: S3Client,
  bucket: string,
  filePath: string,
  key: string,
  label: string,
): Promise<string | null> {
  if (!fs.existsSync(filePath)) {
    console.log(`  MISSING   ${label} (${path.basename(filePath)}) — set without this image`);
    return null;
  }

  const ext = path.extname(filePath).slice(1).toLowerCase();
  const contentType = EXT_CONTENT_TYPE[ext] ?? 'image/jpeg';

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.readFileSync(filePath),
      ContentType: contentType,
    }),
  );

  return key;
}

export async function seedCommunities(prisma: PrismaClient): Promise<void> {
  console.log('\n[Communities]');

  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  let s3: S3Client | null = null;
  if (bucket && region && accessKeyId && secretAccessKey) {
    s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
    console.log(`  S3 bucket : ${bucket}`);
  } else {
    console.log('  WARNING: S3 env vars not set — communities will be created without images');
  }

  // Creator — prefer the super admin (Meetday-managed communities); fall back to the demo host.
  const creator =
    (await prisma.user.findFirst({
      where: { role: { name: 'SUPER_ADMIN' } },
      select: { id: true, email: true },
    })) ??
    (await prisma.user.findUnique({
      where: { firebaseUid: 'seed-demo-host-001' },
      select: { id: true, email: true },
    }));

  if (!creator) {
    throw new Error('No SUPER_ADMIN or demo host user found — run the earlier seeders first');
  }
  console.log(`  Creator   ${creator.email}`);

  let created = 0;
  let skipped = 0;

  for (const def of COMMUNITIES) {
    const exists = await prisma.community.findUnique({ where: { slug: def.slug }, select: { id: true } });
    if (exists) {
      console.log(`  SKIP      ${def.name}`);
      skipped++;
      continue;
    }

    const interest = await prisma.interest.findUnique({ where: { slug: def.interestSlug }, select: { id: true } });
    if (!interest) {
      console.log(`  WARN      Interest "${def.interestSlug}" not found — skipping community`);
      continue;
    }

    // Categories mapped to this interest drive both the category link and event matching.
    const categoryRows = await prisma.interestCategory.findMany({
      where: { interestId: interest.id },
      select: { categoryId: true },
    });
    const categoryIds = categoryRows.map((c) => c.categoryId);
    const categoryId = categoryIds[0] ?? null;

    // Upload images
    let coverImageKey: string | null = null;
    let iconKey: string | null = null;
    if (s3 && bucket) {
      coverImageKey = await uploadImage(
        s3,
        bucket,
        path.join(COVERS_DIR, `${def.interestSlug}.png`),
        `${S3_SEED_PREFIX}/${def.interestSlug}/cover.png`,
        `${def.name} cover`,
      );
      iconKey = await uploadImage(
        s3,
        bucket,
        path.join(ICONS_DIR, `${def.interestSlug}.png`),
        `${S3_SEED_PREFIX}/${def.interestSlug}/icon.png`,
        `${def.name} icon`,
      );
    }

    const community = await prisma.community.create({
      data: {
        name: def.name,
        slug: def.slug,
        description: def.description,
        type: 'MEETDAY_MANAGED_PUBLIC',
        status: 'PUBLISHED',
        access: 'PUBLIC',
        publishedAt: new Date(),
        categoryId,
        primaryCity: def.primaryCity,
        communityCities: COMMUNITY_CITIES,
        interestTags: def.tags,
        coverImageKey,
        iconKey,
        createdBy: creator.id,
        autoAddMatchingEvents: true,
        memberCount: 1,
        settings: { create: {} },
        interests: { create: { interestId: interest.id } },
        members: {
          create: {
            userId: creator.id,
            role: 'OWNER',
            status: 'ACTIVE',
            joinedAt: new Date(),
          },
        },
      },
      select: { id: true },
    });

    // Auto-attach matching PUBLISHED events (mirrors CommunitiesService.resyncEvents).
    let attached = 0;
    if (categoryIds.length) {
      const matches = await prisma.event.findMany({
        where: {
          status: 'PUBLISHED',
          city: { in: COMMUNITY_CITIES },
          categoryId: { in: categoryIds },
        },
        select: { id: true },
      });

      if (matches.length) {
        await prisma.communityEvent.createMany({
          data: matches.map((e) => ({ communityId: community.id, eventId: e.id, source: 'AUTO' as const })),
          skipDuplicates: true,
        });
        attached = matches.length;
        await prisma.community.update({
          where: { id: community.id },
          data: { experienceCount: attached },
        });
      }
    }

    console.log(`  CREATED   ${def.name}  (${attached} events matched)`);
    created++;
  }

  console.log(`  → ${created} created, ${skipped} skipped`);
}
