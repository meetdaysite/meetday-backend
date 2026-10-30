import { PrismaService } from '../../src/prisma/prisma.service';

// Safety guard: these tests wipe rows from every table. Refuse to run unless the connected database
// is clearly a test database, so a misconfigured env can never clear real (local dev or GCP) data.
function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  let dbName = '';
  try {
    dbName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    dbName = '';
  }
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to clear database "${dbName || '(unknown)'}": e2e tests only run against a database whose name contains "test".`,
    );
  }
}

// Deletes all rows from every application table (no TRUNCATE, no schema changes). Foreign-key
// checks are paused for this one transaction so tables can be cleared in any order, and the
// migration history table is left alone.
export async function truncateTables(prisma: PrismaService): Promise<void> {
  assertTestDatabase();
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    for (const { tablename } of rows) {
      await tx.$executeRawUnsafe(`DELETE FROM "public"."${tablename}"`);
    }
  });
}

const ROLES = [
  { name: 'USER', description: 'Regular attendee' },
  { name: 'HOST', description: 'Event host' },
  { name: 'BRAND', description: 'Sponsorship brand' },
  { name: 'CITY_ADMIN', description: 'Manages a city' },
  { name: 'MODERATOR', description: 'Content moderator' },
  { name: 'SUPPORT', description: 'Customer support' },
  { name: 'SUPER_ADMIN', description: 'Full access' },
];

// Must be valid v4 UUIDs to pass IsUUID('4') validation in RegisterDto/ApplyHostDto
const CATEGORIES = [
  { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', name: 'Outdoor Adventures' },
  { id: 'a0eebc99-9c0b-4ef8-ab6d-6bb9bd380a22', name: 'Photography Walks' },
];

const SUBSCRIPTION_PLANS = [
  { plan: 'DISCOVER' as const, yearlyPrice: null, monthlyPrice: null, platformFeeRate: 0, isActive: true },
  { plan: 'SELL' as const, yearlyPrice: 9999, monthlyPrice: null, platformFeeRate: 10, isActive: true },
  { plan: 'COMMUNITY' as const, yearlyPrice: 14999, monthlyPrice: 1499, platformFeeRate: 7, isActive: true },
];

export async function seedRefData(prisma: PrismaService): Promise<void> {
  await Promise.all(
    ROLES.map((r) => prisma.role.create({ data: r })),
  );
  await Promise.all(
    CATEGORIES.map((c) => prisma.category.create({ data: c })),
  );
  await Promise.all(
    SUBSCRIPTION_PLANS.map((p) => prisma.subscriptionPlan.create({ data: p })),
  );
}

export async function createTestUser(
  prisma: PrismaService,
  params: {
    uid: string;
    roleName: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    isActive?: boolean;
    mustCompleteProfile?: boolean;
  },
) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: params.roleName } });
  return prisma.user.create({
    data: {
      firebaseUid: params.uid,
      email: params.email ?? `${params.uid}@test.com`,
      firstName: params.firstName ?? 'Test',
      lastName: params.lastName ?? 'User',
      isActive: params.isActive ?? true,
      mustCompleteProfile: params.mustCompleteProfile ?? false,
      roleId: role.id,
    },
    include: { role: true },
  });
}
