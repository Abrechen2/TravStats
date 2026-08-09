import { prisma } from "../db";
import { comparePassword } from "../utils/password";
import logger from "../utils/logger";

/** The credentials both demo seeders write. Kept in step with seedDemoAccount. */
const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = "demo123";

/**
 * Idempotent repair: the built-in demo account created by a pre-2.5.0 version
 * carries `is_demo = false`, so its sample flights and cruises count towards the
 * instance-wide statistics as though they were real travel, and the demo guards
 * that protect shared API quota never apply to it.
 *
 * This lives OUTSIDE the demo seeder on purpose. 2.5.0 put the same repair
 * inside `ensureUser()` in seedDemoAccount.ts, which `init.ts` runs only when
 * the user table is empty or CREATE_DEMO_USER=true — i.e. never on the installs
 * that actually have the broken row. Measured on a copy of production data: the
 * flag was still false after booting the version whose notes promised the fix.
 *
 * The account is identified by its seeded password, not by its name alone: an
 * install where a real person happens to be called "demo" must keep its data in
 * the statistics. That costs one bcrypt compare per boot, and only when an
 * unflagged "demo" row exists at all.
 */
export async function backfillDemoFlag(): Promise<number> {
  const candidate = await prisma.user.findUnique({
    where: { username: DEMO_USERNAME },
    select: { id: true, isDemo: true, passwordHash: true },
  });

  if (!candidate || candidate.isDemo) return 0;

  const isSeededDemo = await comparePassword(DEMO_PASSWORD, candidate.passwordHash);
  if (!isSeededDemo) {
    logger.info({
      operation: "backfill_demo_flag_skipped",
      message:
        'An account named "demo" does not carry the seeded demo password — left untouched',
    });
    return 0;
  }

  await prisma.user.update({ where: { id: candidate.id }, data: { isDemo: true } });
  logger.info({
    operation: "backfill_demo_flag_done",
    message: "Flagged the built-in demo account as a demo account",
  });
  return 1;
}
