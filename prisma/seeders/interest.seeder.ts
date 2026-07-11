/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
import { Storage } from '@google-cloud/storage';
import * as fs from 'fs';
import * as path from 'path';

const IMAGES_DIR = path.join(__dirname, '..', '..', 'interest-images');
const GCS_KEY_PREFIX = 'interests';

const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const interests = [
  { name: "Founder's Huddle",          slug: 'founders-huddle',         description: 'For startup founders, entrepreneurs, and those building the next big thing' },
  { name: 'AI & Future-Tech',          slug: 'ai-future-tech',          description: 'Exploring artificial intelligence, emerging tech, and the future of innovation' },
  { name: 'Career Pivot Lab',          slug: 'career-pivot-lab',        description: 'For professionals navigating career transitions and reinventing their paths' },
  { name: 'PropTech & Urban Design',   slug: 'proptech-urban-design',   description: 'Where real estate technology meets thoughtful urban planning and design' },
  { name: 'Conscious Living',          slug: 'conscious-living',        description: 'Mindful choices around sustainability, wellness, and intentional everyday life' },
  { name: 'Sunrise Social Clubs',      slug: 'sunrise-social',         description: 'Early risers who believe the best conversations happen before 9 AM' },
  { name: 'Weekend Trekker',           slug: 'weekend-trekker',         description: 'Adventure seekers who hit trails, hills, and the outdoors every chance they get' },
  { name: 'Padel / Pickleball',        slug: 'padel-pickleball',        description: 'Enthusiasts of the fastest-growing racket sports in the country' },
  { name: 'Pet Parents Social',        slug: 'pet-parents-social',      description: 'A community for pet lovers to connect, share, and explore with their furry friends' },
  { name: 'Supper Club',              slug: 'supper-club',             description: 'Food lovers who gather around great meals, wine, and even better company' },
  { name: "Urban Explorer's Guild",    slug: 'urban-explorers-guild',   description: 'Curious souls discovering hidden gems, street art, and stories in the city' },
  { name: 'Modern Art & Gallery Hops', slug: 'modern-art-gallery-hops', description: 'Art enthusiasts exploring contemporary galleries, installations, and creative spaces' },
  { name: 'Documentary & Discourse',   slug: 'documentary-discourse',   description: 'Thinkers who love thought-provoking films and the conversations that follow' },
  { name: 'Tactile Makerspace',        slug: 'tactile-makerspace',      description: 'Makers, crafters, and builders who love creating things with their hands' },
  { name: 'Strategic Board Gaming',    slug: 'strategic-board-gaming',  description: 'Tabletop enthusiasts who live for strategy, bluffing, and a well-played endgame' },
  { name: 'Wellness & Mindfulness',    slug: 'wellness-mindfulness',    description: 'A space for yoga, meditation, and all things that nurture the mind and body' },
  { name: 'Creator Meetups',           slug: 'creator-meetups',         description: 'Content creators, influencers, and digital builders connecting in real life' },
];

function findImageFile(slug: string): string | null {
  for (const ext of Object.keys(EXT_CONTENT_TYPE)) {
    const filePath = path.join(IMAGES_DIR, `${slug}.${ext}`);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

async function uploadInterestImage(
  storage: Storage,
  bucket: string,
  interestId: string,
  filePath: string,
): Promise<string> {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const contentType = EXT_CONTENT_TYPE[ext] ?? 'image/jpeg';
  // Deterministic key (not randomUUID) so re-running the seeder overwrites in place
  // instead of accumulating orphaned objects — that's what makes this idempotent.
  const key = `${GCS_KEY_PREFIX}/${interestId}/seed-icon.${ext}`;

  await storage.bucket(bucket).file(key).save(fs.readFileSync(filePath), { contentType });

  return key;
}

export async function seedInterests(prisma: PrismaClient): Promise<void> {
  console.log('\n[Interests]');

  const bucket = process.env.GCP_STORAGE_BUCKET;
  const projectId = process.env.GCP_PROJECT_ID;
  const keyFile = process.env.GCP_KEY_FILE;

  let gcs: Storage | null = null;
  if (bucket && projectId) {
    gcs = new Storage({ projectId, ...(keyFile && { keyFilename: keyFile }) });
    console.log(`  GCS bucket: ${bucket}`);
  } else {
    console.log('  WARNING: GCS env vars not set — interests will be created/updated without images');
  }

  const existing = await prisma.interest.findMany({ select: { id: true, slug: true, image: true } });
  const existingBySlug = new Map(existing.map((i) => [i.slug, i]));

  let created = 0;
  let imaged = 0;
  let skipped = 0;

  for (const interest of interests) {
    const found = existingBySlug.get(interest.slug);

    if (!found) {
      const imageFile = findImageFile(interest.slug);
      if (gcs && bucket && imageFile) {
        // Create first to get an id, then upload keyed by that id.
        const row = await prisma.interest.create({ data: interest });
        const image = await uploadInterestImage(gcs, bucket, row.id, imageFile);
        await prisma.interest.update({ where: { id: row.id }, data: { image } });
        console.log(`  CREATED ${interest.name} (with image)`);
      } else {
        await prisma.interest.create({ data: interest });
        console.log(`  CREATED ${interest.name}${imageFile ? '' : ' (no image file found)'}`);
      }
      created++;
      continue;
    }

    // Already exists — only backfill a missing image, never touch anything else.
    if (!found.image && gcs && bucket) {
      const imageFile = findImageFile(interest.slug);
      if (imageFile) {
        const image = await uploadInterestImage(gcs, bucket, found.id, imageFile);
        await prisma.interest.update({ where: { id: found.id }, data: { image } });
        console.log(`  IMAGE   ${interest.name} (backfilled)`);
        imaged++;
        continue;
      }
    }

    console.log(`  SKIP    ${interest.name}`);
    skipped++;
  }

  console.log(`  → ${created} created, ${imaged} images backfilled, ${skipped} skipped`);
}
