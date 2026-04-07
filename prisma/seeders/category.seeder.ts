import { PrismaClient } from '@prisma/client';

const categories = [
  { name: 'Social Mixers', description: 'Casual get-togethers to meet new people and expand your social circle' },
  { name: 'Food & Drink', description: 'Dining experiences, tastings, pop-ups, and culinary events' },
  { name: 'Wellness & Fitness', description: 'Yoga, meditation, group workouts, and holistic health experiences' },
  { name: 'Creative Workshops', description: 'Hands-on sessions in art, craft, writing, photography, and more' },
  { name: 'Networking & Professional', description: 'Career-focused events for making meaningful professional connections' },
  { name: 'Tech & Startups', description: 'Hackathons, product demos, founder meetups, and tech community events' },
  { name: 'Arts & Culture', description: 'Theatre, exhibitions, film screenings, and cultural experiences' },
  { name: 'Outdoor Adventures', description: 'Hikes, cycling, camping, and nature-based group activities' },
  { name: 'Hobby Meetups', description: 'Find others who share your passion — from board games to book clubs' },
  { name: 'Music & Nightlife', description: 'Live music, DJ nights, open mics, and after-dark social events' },
  { name: 'Standup & Comedy', description: 'Stand-up shows, improv nights, and comedy open mics' },
];

export async function seedCategories(prisma: PrismaClient): Promise<void> {
  console.log('\n[Categories]');

  const existing = await prisma.category.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((c) => c.name));

  let created = 0;
  let skipped = 0;

  for (const category of categories) {
    if (existingNames.has(category.name)) {
      console.log(`  SKIP    ${category.name}`);
      skipped++;
    } else {
      await prisma.category.create({ data: category });
      console.log(`  CREATED ${category.name}`);
      created++;
    }
  }

  console.log(`  → ${created} created, ${skipped} skipped`);
}
