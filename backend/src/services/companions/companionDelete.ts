import { Prisma } from "../../prisma";
import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { COMPANION_USE_KINDS } from "./companionJoins";
import { loadStayLinks } from "./companionStays";
import { COUNT_SELECT, notFound, usesOf } from "./manageCompanions";

/**
 * Deleting a companion, check and write as ONE step. The usage is read only
 * after the rows are locked (`FOR UPDATE`): a join row, an expense's payer or
 * an account link taking hold of the companion meanwhile needs that same row
 * (an FK insert takes `FOR KEY SHARE`, a link is an UPDATE of it), so it
 * either committed before the lock — and the count below sees it — or waits
 * until the delete is done. Checking in one statement and deleting in another
 * let such a link be cascaded away under a 204 (found by the Codex review).
 */
async function lockedUsage(tx: DbTransaction, userId: string, id?: string) {
  const only = id ? Prisma.sql`AND id = ${id}` : Prisma.empty;
  const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM companions WHERE user_id = ${userId} ${only} FOR UPDATE`);
  const rows = await tx.companion.findMany({
    where: { userId, id: { in: locked.map((r) => r.id) } },
    select: { id: true, canonicalName: true, linkedUserId: true, _count: { select: COUNT_SELECT } },
  });
  const stays = await loadStayLinks(tx, userId, rows);
  return rows.map((row) => {
    const uses = usesOf(row, stays.byCompanion);
    const entries = COMPANION_USE_KINDS.reduce((sum, kind) => sum + uses[kind], 0);
    const expenses = row._count.expensesPaid;
    const linked = row.linkedUserId !== null;
    return { id: row.id, entries, expenses, linked, used: entries > 0 || expenses > 0 || linked };
  });
}

/** Deletes a companion no entry, stay, expense or account link still names. */
export async function deleteCompanion(userId: string, id: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const [usage] = await lockedUsage(tx, userId, id);
      if (!usage) throw notFound();
      if (usage.used) {
        const { entries, expenses, linked } = usage;
        throw new AppError("The companion is still in use", 409, "COMPANION_IN_USE", undefined, {
          entries,
          expenses,
          linked,
        });
      }
      await tx.companion.delete({ where: { id } });
    },
    { timeout: 30_000 }
  );
}

/** Deletes every unused companion of the caller's at once; answers how many went. */
export async function deleteUnusedCompanions(userId: string): Promise<{ deleted: number }> {
  return prisma.$transaction(
    async (tx) => {
      const unused = (await lockedUsage(tx, userId)).filter((u) => !u.used).map((u) => u.id);
      if (unused.length === 0) return { deleted: 0 };
      const { count } = await tx.companion.deleteMany({ where: { userId, id: { in: unused } } });
      return { deleted: count };
    },
    { timeout: 30_000 }
  );
}
