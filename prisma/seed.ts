import { PrismaClient } from '@prisma/client';
import { seedRoles } from './seeders/role.seeder';
import { seedCategories } from './seeders/category.seeder';
import { seedCategoryHighlights } from './seeders/category-highlight.seeder';
import { seedSuperAdmin } from './seeders/super-admin.seeder';
import { seedSubscriptionPlans } from './seeders/subscription-plan.seeder';
import { seedInterests } from './seeders/interest.seeder';
import { seedInterestCategories } from './seeders/interest-category.seeder';
import { seedEvents } from './seeders/event.seeder';
import { seedCommunities } from './seeders/community.seeder';

const prisma = new PrismaClient();

async function main() {
  await seedRoles(prisma);
  await seedCategories(prisma);
  await seedCategoryHighlights(prisma);
  await seedInterests(prisma);
  await seedInterestCategories(prisma);
  await seedSuperAdmin(prisma);
  await seedSubscriptionPlans(prisma);
  await seedEvents(prisma);
  await seedCommunities(prisma);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
