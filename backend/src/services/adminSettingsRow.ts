import { prisma } from "../db";

/**
 * `AdminSettings` is a singleton, and nothing in the schema says so.
 *
 * The id is an autoincrement with no uniqueness constraint on anything else,
 * and eleven places create the row with the same shape: read it, and if there
 * is none, create one. Two of those running at once on a fresh instance — the
 * logging config at boot and an admin opening a settings page, say — both see
 * nothing and both insert. From then on the instance has two rows, and since
 * every one of the forty-odd reads used a bare `findFirst()`, which Postgres
 * answers in physical order, the answer changes whenever an UPDATE moves a
 * tuple. An admin saves the Immich URL on one page and another page reads the
 * other row, so the setting looks like it did not stick.
 *
 * Found while checking why `lodgingCurrencyEndToEnd` was red: the test database
 * held FOUR rows, and the test disabled a flag on one while the request read
 * another. Not on the audit's list — this one came out of the counter-check.
 *
 * Two halves to the fix, and both are needed. Every read now carries
 * `orderBy: { id: "asc" }`, so a split instance at least answers consistently.
 * And creation goes through this module, which takes an advisory lock first, so
 * no new instance can split in the first place.
 *
 * Deliberately NOT done here: merging rows an instance already has. Which of
 * two divergent settings rows is the real one is a question only the operator
 * can answer, and a migration that guesses would delete configuration.
 */

/** Same shape as `userCountLock` — an arbitrary, stable, project-unique key. */
const ADMIN_SETTINGS_LOCK = 5417_223_901;

/**
 * The id of the settings row, creating it if the instance has none.
 *
 * The lock is transaction-scoped, so it is released on commit or rollback with
 * no unlock call to forget. A caller that already holds a transaction should
 * pass it in rather than nesting one.
 */
export async function ensureAdminSettingsRow(): Promise<number> {
  const existing = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  return prisma.$transaction(async (tx) => {
    // `$executeRaw`, not `$queryRaw`: the function returns void, and asking
    // for its rows fails to deserialize.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_SETTINGS_LOCK})`;
    // Re-read INSIDE the lock: the row may have appeared while we waited, and
    // creating a second one is the whole failure this exists to prevent.
    const row = await tx.adminSettings.findFirst({
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (row) return row.id;
    const created = await tx.adminSettings.create({ data: {}, select: { id: true } });
    return created.id;
  });
}
