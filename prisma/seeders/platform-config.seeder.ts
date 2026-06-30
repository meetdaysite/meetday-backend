import { PrismaClient } from '@prisma/client';

const configs: { key: string; value: string }[] = [
  { key: 'gst_rate', value: '0.18' },
];

export async function seedPlatformConfig(prisma: PrismaClient): Promise<void> {
  console.log('\n[Platform Config]');

  let created = 0;
  let skipped = 0;

  for (const config of configs) {
    const existing = await prisma.platformConfig.findUnique({ where: { key: config.key } });

    if (existing) {
      console.log(`  SKIP    ${config.key}`);
      skipped++;
    } else {
      await prisma.platformConfig.create({ data: config });
      console.log(`  CREATED ${config.key} = ${config.value}`);
      created++;
    }
  }

  console.log(`  → ${created} created, ${skipped} skipped`);
}
