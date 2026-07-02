/**
 * One-off backfill for HostProfile.totalEventsHosted.
 * Sets totalEventsHosted = COUNT of PUBLISHED events per host.
 * Idempotent — safe to re-run.
 *
 * Run: npm run script:total-events-hosted-backfill
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('— Setting totalEventsHosted from PUBLISHED events…');
  const updated = await prisma.$executeRaw`
    UPDATE host_profiles hp
    SET "totalEventsHosted" = sub.cnt
    FROM (
      SELECT "hostProfileId", COUNT(*)::int AS cnt
      FROM events
      WHERE status = 'PUBLISHED'
      GROUP BY "hostProfileId"
    ) sub
    WHERE hp.id = sub."hostProfileId"
  `;
  console.log(`  updated ${updated} host profile(s) with published event counts`);

  console.log('— Zeroing hosts with no PUBLISHED events…');
  const zeroed = await prisma.$executeRaw`
    UPDATE host_profiles
    SET "totalEventsHosted" = 0
    WHERE id NOT IN (
      SELECT DISTINCT "hostProfileId"
      FROM events
      WHERE status = 'PUBLISHED'
        AND "hostProfileId" IS NOT NULL
    )
  `;
  console.log(`  zeroed ${zeroed} host profile(s)`);

  console.log('Backfill complete.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
