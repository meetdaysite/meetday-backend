import { PrismaClient } from '@prisma/client';

const categories = [
  { name: 'Investor Meetups', description: 'Curated gatherings for investors, angels, and VCs to connect and explore deals' },
  { name: 'Demo Days', description: 'Startup pitch events where founders showcase products to investors and the community' },
  { name: 'Hackathons', description: 'Intensive build sprints where teams collaborate to solve problems and ship fast' },
  { name: 'Workshops', description: 'Hands-on learning sessions covering skills, tools, and practical knowledge' },
  { name: 'Live Podcasts', description: 'Podcast recordings done live in front of an audience with Q&A and interaction' },
  { name: 'Masterclasses', description: 'Deep-dive sessions led by experts sharing advanced knowledge in their field' },
  { name: 'Breakfast Meetups', description: 'Early morning networking over breakfast — light, focused, and time-efficient' },
  { name: 'Community Mixers', description: 'Relaxed social events for a community to bond, mingle, and grow together' },
  { name: 'Support a Cause Days', description: 'Events centred around giving back — volunteering, fundraising, or awareness drives' },
  { name: 'Wellness Retreat', description: 'Immersive wellness experiences covering mindfulness, yoga, and holistic health' },
  { name: 'Outdoor Activities', description: 'Group activities in nature — hikes, cycling, walks, and open-air experiences' },
  { name: 'Adventure Days', description: 'Thrill-seeking group outings like trekking, rock climbing, or off-road trips' },
  { name: 'Hobby Clubs', description: 'Regular meetups built around a shared hobby — from board games to book clubs' },
  { name: 'Wine / Food Tasting', description: 'Curated tasting experiences exploring wines, spirits, cuisines, and flavours' },
  { name: 'Sundowner', description: 'Evening gatherings timed around sunset — drinks, views, and good company' },
  { name: 'Art Festival', description: 'Multi-format celebrations of visual and performing arts, open to all' },
  { name: 'Musical Concerts', description: 'Live music performances across genres — intimate gigs to larger stage shows' },
  { name: 'Movie Nights', description: 'Outdoor or indoor film screenings with a social, community feel' },
  { name: 'Startup Roast', description: 'Light-hearted roast format where founders get honest (and funny) feedback' },
  { name: 'Creator Meetups', description: 'Gatherings for content creators, influencers, and digital builders to connect' },
  { name: 'Standup Comedy', description: 'Stand-up shows, open mics, and improv nights for laughs and good times' },
  { name: 'Jamming Sessions', description: 'Informal music jams where musicians of all levels play and collaborate together' },
];

// Community Space categories — a separate discriminated set (type: SPACE) describing what kind
// of physical space is being listed, distinct from the EXPERIENCE categories above.
const spaceCategories = [
  { name: 'Co-working', description: 'Shared/flexible workspaces for individuals and teams', type: 'SPACE' as const },
  { name: 'Gym', description: 'Fitness centres and gyms', type: 'SPACE' as const },
  { name: 'Wellness Centre', description: 'Spaces focused on wellness, spa, and holistic health', type: 'SPACE' as const },
  { name: 'Sports Centre', description: 'Facilities for sports and athletic activities', type: 'SPACE' as const },
  { name: 'Community Centre', description: 'General-purpose community gathering spaces', type: 'SPACE' as const },
  { name: 'Social Club', description: 'Members clubs and social spaces', type: 'SPACE' as const },
  { name: 'Others', description: 'Other kinds of community spaces', type: 'SPACE' as const },
];

export async function seedCategories(prisma: PrismaClient): Promise<void> {
  console.log('\n[Categories]');

  const existing = await prisma.category.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((c) => c.name));

  let created = 0;
  let skipped = 0;

  for (const category of [...categories, ...spaceCategories]) {
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
