import { PrismaClient } from '@prisma/client';

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

export async function seedInterests(prisma: PrismaClient): Promise<void> {
  console.log('\n[Interests]');

  const existing = await prisma.interest.findMany({ select: { slug: true } });
  const existingSlugs = new Set(existing.map((i) => i.slug));

  let created = 0;
  let skipped = 0;

  for (const interest of interests) {
    if (existingSlugs.has(interest.slug)) {
      console.log(`  SKIP    ${interest.name}`);
      skipped++;
    } else {
      await prisma.interest.create({ data: interest });
      console.log(`  CREATED ${interest.name}`);
      created++;
    }
  }

  console.log(`  → ${created} created, ${skipped} skipped`);
}
