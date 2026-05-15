import { PrismaClient } from '@prisma/client';

const HIGHLIGHTS: Record<string, Array<{ key: string; label: string }>> = {
  'Investor Meetups': [
    { key: 'GREAT_NETWORKING', label: 'Great Networking' },
    { key: 'VALUABLE_CONNECTIONS', label: 'Valuable Connections' },
    { key: 'GREAT_SPEAKERS', label: 'Great Speakers' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Demo Days': [
    { key: 'GREAT_PITCHES', label: 'Great Pitches' },
    { key: 'INNOVATIVE_IDEAS', label: 'Innovative Ideas' },
    { key: 'GREAT_SPEAKERS', label: 'Great Speakers' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Hackathons': [
    { key: 'GREAT_MENTORS', label: 'Great Mentors' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'GREAT_PRIZES', label: 'Great Prizes' },
    { key: 'GREAT_ENERGY', label: 'Great Energy' },
    { key: 'GOOD_TEAM_SPIRIT', label: 'Good Team Spirit' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Workshops': [
    { key: 'GREAT_SPEAKER', label: 'Great Speaker' },
    { key: 'PRACTICAL_CONTENT', label: 'Practical Content' },
    { key: 'WELL_STRUCTURED', label: 'Well Structured' },
    { key: 'GREAT_QA', label: 'Great Q&A' },
    { key: 'SMALL_GROUP_FEEL', label: 'Small Group Feel' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Live Podcasts': [
    { key: 'GREAT_GUEST', label: 'Great Guest' },
    { key: 'GREAT_CONVERSATION', label: 'Great Conversation' },
    { key: 'INTERACTIVE_QA', label: 'Interactive Q&A' },
    { key: 'GOOD_PRODUCTION', label: 'Good Production' },
    { key: 'INTIMATE_FEEL', label: 'Intimate Feel' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Masterclasses': [
    { key: 'EXPERT_KNOWLEDGE', label: 'Expert Knowledge' },
    { key: 'PRACTICAL_INSIGHTS', label: 'Practical Insights' },
    { key: 'GREAT_QA', label: 'Great Q&A' },
    { key: 'WELL_STRUCTURED', label: 'Well Structured' },
    { key: 'GREAT_SPEAKER', label: 'Great Speaker' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Breakfast Meetups': [
    { key: 'GREAT_FOOD', label: 'Great Food' },
    { key: 'GREAT_NETWORKING', label: 'Great Networking' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'GREAT_VIBE', label: 'Great Vibe' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Community Mixers': [
    { key: 'GREAT_VIBE', label: 'Great Vibe' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'GREAT_NETWORKING', label: 'Great Networking' },
    { key: 'INCLUSIVE_ATMOSPHERE', label: 'Inclusive Atmosphere' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Support a Cause Days': [
    { key: 'MEANINGFUL_CAUSE', label: 'Meaningful Cause' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'GOOD_TEAM_SPIRIT', label: 'Good Team Spirit' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'IMPACTFUL_EXPERIENCE', label: 'Impactful Experience' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Wellness Retreat': [
    { key: 'GREAT_INSTRUCTOR', label: 'Great Instructor' },
    { key: 'RELAXING_ATMOSPHERE', label: 'Relaxing Atmosphere' },
    { key: 'TRANSFORMATIVE_EXPERIENCE', label: 'Transformative Experience' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Outdoor Activities': [
    { key: 'GREAT_ROUTE', label: 'Great Route' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'SAFE_EXPERIENCE', label: 'Safe Experience' },
    { key: 'GREAT_ENERGY', label: 'Great Energy' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Adventure Days': [
    { key: 'THRILLING_EXPERIENCE', label: 'Thrilling Experience' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'SAFE_EXPERIENCE', label: 'Safe Experience' },
    { key: 'GREAT_GUIDES', label: 'Great Guides' },
    { key: 'GREAT_ENERGY', label: 'Great Energy' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Hobby Clubs': [
    { key: 'WELCOMING_COMMUNITY', label: 'Welcoming Community' },
    { key: 'GREAT_ACTIVITIES', label: 'Great Activities' },
    { key: 'INCLUSIVE_ATMOSPHERE', label: 'Inclusive Atmosphere' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Wine / Food Tasting': [
    { key: 'GREAT_SELECTION', label: 'Great Selection' },
    { key: 'EXPERT_HOST', label: 'Expert Host' },
    { key: 'GREAT_AMBIANCE', label: 'Great Ambiance' },
    { key: 'EDUCATIONAL_EXPERIENCE', label: 'Educational Experience' },
    { key: 'GREAT_FOOD', label: 'Great Food' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Sundowner': [
    { key: 'GREAT_VIEWS', label: 'Great Views' },
    { key: 'GREAT_VIBE', label: 'Great Vibe' },
    { key: 'GREAT_AMBIANCE', label: 'Great Ambiance' },
    { key: 'GREAT_DRINKS', label: 'Great Drinks' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Art Festival': [
    { key: 'GREAT_ART', label: 'Great Art' },
    { key: 'DIVERSE_EXHIBITS', label: 'Diverse Exhibits' },
    { key: 'GREAT_VIBE', label: 'Great Vibe' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'GREAT_ENERGY', label: 'Great Energy' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Musical Concerts': [
    { key: 'GREAT_PERFORMANCE', label: 'Great Performance' },
    { key: 'GREAT_SOUND', label: 'Great Sound' },
    { key: 'GREAT_ENERGY', label: 'Great Energy' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'GREAT_VIBE', label: 'Great Vibe' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Movie Nights': [
    { key: 'GREAT_FILM_CHOICE', label: 'Great Film Choice' },
    { key: 'GREAT_AMBIANCE', label: 'Great Ambiance' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'COZY_ATMOSPHERE', label: 'Cozy Atmosphere' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Startup Roast': [
    { key: 'GREAT_ROASTERS', label: 'Great Roasters' },
    { key: 'CONSTRUCTIVE_FEEDBACK', label: 'Constructive Feedback' },
    { key: 'GREAT_HUMOR', label: 'Great Humor' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'GREAT_ENERGY', label: 'Great Energy' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Creator Meetups': [
    { key: 'GREAT_NETWORKING', label: 'Great Networking' },
    { key: 'GREAT_COLLAB_VIBES', label: 'Great Collab Vibes' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'WELL_ORGANIZED', label: 'Well Organized' },
    { key: 'GREAT_SPEAKERS', label: 'Great Speakers' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Standup Comedy': [
    { key: 'GREAT_COMEDY', label: 'Great Comedy' },
    { key: 'GREAT_PERFORMER', label: 'Great Performer' },
    { key: 'GOOD_CROWD', label: 'Good Crowd' },
    { key: 'GREAT_ENERGY', label: 'Great Energy' },
    { key: 'HILARIOUS_SHOW', label: 'Hilarious Show' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
  'Jamming Sessions': [
    { key: 'GREAT_MUSICIANS', label: 'Great Musicians' },
    { key: 'INCLUSIVE_ATMOSPHERE', label: 'Inclusive Atmosphere' },
    { key: 'GREAT_ENERGY', label: 'Great Energy' },
    { key: 'WELCOMING_COMMUNITY', label: 'Welcoming Community' },
    { key: 'GREAT_SOUND', label: 'Great Sound' },
    { key: 'SMOOTH_ENTRY', label: 'Smooth Entry' },
    { key: 'FELT_SAFE', label: 'Felt Safe' },
  ],
};

export async function seedCategoryHighlights(prisma: PrismaClient): Promise<void> {
  console.log('\n[Category Highlights]');

  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  const categoryMap = new Map(categories.map((c) => [c.name, c.id]));

  let created = 0;
  let skipped = 0;

  for (const [categoryName, highlights] of Object.entries(HIGHLIGHTS)) {
    const categoryId = categoryMap.get(categoryName);
    if (!categoryId) {
      console.log(`  WARN    Category not found: ${categoryName}`);
      continue;
    }

    for (let i = 0; i < highlights.length; i++) {
      const { key, label } = highlights[i];
      const existing = await prisma.categoryHighlight.findUnique({
        where: { categoryId_key: { categoryId, key } },
        select: { id: true },
      });

      if (existing) {
        skipped++;
      } else {
        await prisma.categoryHighlight.create({ data: { categoryId, key, label, sortOrder: i } });
        created++;
      }
    }
  }

  console.log(`  → ${created} created, ${skipped} skipped`);
}
