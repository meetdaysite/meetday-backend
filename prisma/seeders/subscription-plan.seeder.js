"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedSubscriptionPlans = seedSubscriptionPlans;
const plans = [
    { plan: 'DISCOVER', yearlyPrice: null, monthlyPrice: null, platformFeeRate: 0.2 },
    { plan: 'SELL', yearlyPrice: 8300.0, monthlyPrice: null, platformFeeRate: 0.15 },
    { plan: 'COMMUNITY', yearlyPrice: 10000.0, monthlyPrice: 1250.0, platformFeeRate: 0.15 },
];
async function seedSubscriptionPlans(prisma) {
    console.log('\n[Subscription Plans]');
    let created = 0;
    let skipped = 0;
    for (const plan of plans) {
        const existing = await prisma.subscriptionPlan.findUnique({ where: { plan: plan.plan } });
        if (existing) {
            console.log(`  SKIP    ${plan.plan}`);
            skipped++;
        }
        else {
            await prisma.subscriptionPlan.create({ data: plan });
            console.log(`  CREATED ${plan.plan}`);
            created++;
        }
    }
    console.log(`  → ${created} created, ${skipped} skipped`);
}
//# sourceMappingURL=subscription-plan.seeder.js.map