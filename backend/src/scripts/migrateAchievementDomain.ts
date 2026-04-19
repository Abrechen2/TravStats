/**
 * One-shot: upgrade country/continent-style achievements from
 * domain='flight' to domain='shared', so cruise ports contribute.
 * Safe to re-run — idempotent UPDATE.
 */
import { prisma } from '../db';
import logger from '../utils/logger';

export const SHARED_ACHIEVEMENT_CODE_PATTERNS: RegExp[] = [
  /^COUNTRY_/i,
  /^COUNTRIES_/i,
  /^CONTINENT_/i,
  /^CONTINENTS_/i,
];

export function shouldBeShared(code: string): boolean {
  return SHARED_ACHIEVEMENT_CODE_PATTERNS.some((re) => re.test(code));
}

export async function migrateAchievementDomain(): Promise<{ updated: number }> {
  const all = await prisma.achievement.findMany({ select: { id: true, code: true } });
  const sharedIds = all.filter((a) => shouldBeShared(a.code)).map((a) => a.id);
  if (sharedIds.length === 0) {
    return { updated: 0 };
  }
  const result = await prisma.achievement.updateMany({
    where: { id: { in: sharedIds } },
    data: { domain: 'shared' },
  });
  logger.info({ operation: 'migrateAchievementDomain', updated: result.count });
  return { updated: result.count };
}

if (require.main === module) {
  migrateAchievementDomain()
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(`Updated ${r.updated} achievements to domain='shared'.`);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
