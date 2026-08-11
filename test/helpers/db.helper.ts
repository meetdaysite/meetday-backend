import { PrismaService } from '../../src/prisma/prisma.service';

// Truncate all user-data tables in child-first order to respect FK constraints.
// Roles, Categories and SubscriptionPlans are preserved — they are re-seeded by
// seedRefData() below.
export async function truncateTables(prisma: PrismaService): Promise<void> {
  await prisma.couponRedemption.deleteMany();
  await prisma.hostPayoutAccountHistory.deleteMany();
  await prisma.hostPayoutAccount.deleteMany();
  await prisma.hostSubscription.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.hostExperienceCategory.deleteMany();
  await prisma.userInterestAffinity.deleteMany();
  await prisma.hostAddress.deleteMany();
  await prisma.hostProfile.deleteMany();
  await prisma.adminProfile.deleteMany();
  await prisma.attendeeProfile.deleteMany();
  await prisma.brandProfile.deleteMany();
  await prisma.consentRecord.deleteMany();
  // Bypass the soft-delete middleware by passing deletedAt as an explicit key.
  await (prisma.user as any).deleteMany({ where: { deletedAt: undefined } });
  await prisma.category.deleteMany();
  await prisma.subscriptionPlan.deleteMany();
  await prisma.role.deleteMany();
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
