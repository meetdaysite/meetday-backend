"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const role_seeder_1 = require("./seeders/role.seeder");
const category_seeder_1 = require("./seeders/category.seeder");
const super_admin_seeder_1 = require("./seeders/super-admin.seeder");
const subscription_plan_seeder_1 = require("./seeders/subscription-plan.seeder");
const prisma = new client_1.PrismaClient();
async function main() {
    await (0, role_seeder_1.seedRoles)(prisma);
    await (0, category_seeder_1.seedCategories)(prisma);
    await (0, super_admin_seeder_1.seedSuperAdmin)(prisma);
    await (0, subscription_plan_seeder_1.seedSubscriptionPlans)(prisma);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=seed.js.map