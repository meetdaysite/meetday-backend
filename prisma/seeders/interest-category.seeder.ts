import { PrismaClient } from '@prisma/client';

const MAPPINGS: Record<string, string[]> = {
  'founders-huddle':       ['Investor Meetups', 'Demo Days', 'Hackathons'],
  'ai-future-tech':        ['Workshops', 'Live Podcasts', 'Masterclasses'],
  'career-pivot-lab':      ['Masterclasses', 'Breakfast Meetups', 'Live Podcasts'],
  'proptech-urban-design': ['Workshops', 'Masterclasses', 'Community Mixers'],
  'conscious-living':      ['Workshops', 'Support a Cause Days', 'Wellness Retreat'],
  'sunrise-social':        ['Outdoor Activities', 'Wellness Retreat', 'Adventure Days'],
  'weekend-trekker':       ['Adventure Days', 'Outdoor Activities'],
  'padel-pickleball':      ['Hobby Clubs', 'Adventure Days'],
  'pet-parents-social':    ['Outdoor Activities', 'Breakfast Meetups'],
  'supper-club':           ['Wine / Food Tasting', 'Sundowner', 'Breakfast Meetups'],
  'urban-explorers-guild': ['Outdoor Activities', 'Adventure Days'],
  'modern-art-gallery-hops': ['Art Festival', 'Musical Concerts', 'Movie Nights'],
  'documentary-discourse': ['Movie Nights', 'Live Podcasts', 'Masterclasses'],
  'tactile-makerspace':    ['Art Festival', 'Workshops', 'Creator Meetups'],
  'strategic-board-gaming':['Community Mixers', 'Startup Roast'],
  'wellness-mindfulness':  ['Wellness Retreat', 'Support a Cause Days'],
  'creator-meetups':       ['Live Podcasts', 'Standup Comedy', 'Jamming Sessions'],
};

export async function seedInterestCategories(prisma: PrismaClient) {
  const interests = await prisma.interest.findMany({ select: { id: true, slug: true } });
  const categories = await prisma.category.findMany({ select: { id: true, name: true } });

  const interestBySlug = new Map(interests.map((i) => [i.slug, i.id]));
  const categoryByName = new Map(categories.map((c) => [c.name, c.id]));

  const pairs: { interestId: string; categoryId: string }[] = [];

  for (const [slug, categoryNames] of Object.entries(MAPPINGS)) {
    const interestId = interestBySlug.get(slug);
    if (!interestId) {
      console.warn(`[interest-category] interest slug not found: ${slug}`);
      continue;
    }
    for (const name of categoryNames) {
      const categoryId = categoryByName.get(name);
      if (!categoryId) {
        console.warn(`[interest-category] category name not found: "${name}"`);
        continue;
      }
      pairs.push({ interestId, categoryId });
    }
  }

  await prisma.interestCategory.createMany({ data: pairs, skipDuplicates: true });
  console.log(`[interest-category] seeded ${pairs.length} mappings`);
}
