"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedRoles = seedRoles;
const roles = [
    { name: 'USER', description: 'Standard platform user' },
    { name: 'HOST', description: 'Event host who can create and manage events' },
    { name: 'MODERATOR', description: 'Moderates event activity and content' },
    { name: 'SUPPORT', description: 'Platform support staff' },
    { name: 'CITY_ADMIN', description: 'Administers events within a city' },
    { name: 'SUPER_ADMIN', description: 'Full platform administrator' },
];
async function seedRoles(prisma) {
    console.log('\n[Roles]');
    const existing = await prisma.role.findMany({ select: { name: true } });
    const existingNames = new Set(existing.map((r) => r.name));
    let created = 0;
    let skipped = 0;
    for (const role of roles) {
        if (existingNames.has(role.name)) {
            console.log(`  SKIP    ${role.name}`);
            skipped++;
        }
        else {
            await prisma.role.create({ data: role });
            console.log(`  CREATED ${role.name}`);
            created++;
        }
    }
    console.log(`  → ${created} created, ${skipped} skipped`);
}
//# sourceMappingURL=role.seeder.js.map