import { PrismaClient } from '@prisma/client';
import { seedRoles } from './seeders/role.seeder';
import { seedCategories } from './seeders/category.seeder';
import { seedSuperAdmin } from './seeders/super-admin.seeder';

const prisma = new PrismaClient();

async function main() {
  await seedRoles(prisma);
  await seedCategories(prisma);
  await seedSuperAdmin(prisma);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
