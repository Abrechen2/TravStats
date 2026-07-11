import { prisma } from '../db';
import { checkAndUpdateAchievements } from '../utils/achievements';
import logger from '../utils/logger';

/**
 * Re-evaluate every user's achievements once.
 *
 * The engine only runs on a flight or cruise write (and on POST /achievements/check).
 * A user who never adds anything would therefore keep a badge that a scoring fix has
 * since invalidated — the continent mapping used to call the Arctic "Antarctica" and
 * counted a phantom "Middle East" continent, so CONTINENTS_7 was reachable without ever
 * going south. Without this pass those badges would linger indefinitely.
 *
 * Idempotent and cheap in the steady state: `checkAndUpdateAchievements` skips the write
 * whenever the stored progress already matches, so a boot where nothing changed performs
 * no writes at all.
 */
export async function recheckAllAchievements(): Promise<{
  users: number;
  failed: number;
}> {
  const users = await prisma.user.findMany({ select: { id: true } });

  let failed = 0;
  for (const user of users) {
    try {
      // Revocations are logged inside the engine, per user, with the achievement codes.
      await checkAndUpdateAchievements(user.id);
    } catch (error) {
      // One broken user must not stop the rest — and must not stop the server booting.
      failed++;
      logger.warn({
        operation: 'achievement_recheck_user_failed',
        message: 'Failed to re-evaluate achievements for a user',
        context: { userId: user.id },
        error,
      });
    }
  }

  return { users: users.length, failed };
}

if (require.main === module) {
  recheckAllAchievements()
    .then(({ users, failed }) => {
      logger.info({
        operation: 'achievement_recheck_cli',
        message: `Re-evaluated achievements for ${users - failed} of ${users} users`,
      });
      return prisma.$disconnect();
    })
    .catch(async (error) => {
      logger.error({
        operation: 'achievement_recheck_cli_failed',
        message: 'Achievement re-check failed',
        error,
      });
      await prisma.$disconnect();
      process.exit(1);
    });
}
