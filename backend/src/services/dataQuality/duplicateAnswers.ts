import type { DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { duplicateCandidateDetailsSchema } from "../../schemas/dataQualityRecordChecks";

/**
 * One account's duplicate questions are answered and created one at a time.
 *
 * A group of three copies carries two flags. `keep` on one answers the other
 * too — but only if the other exists when `keep` looks. A run creating it in
 * between would ask a question the user has just answered, for good. So
 * `keep` and the runner's create of a duplicate flag take the same
 * transaction-scoped advisory lock: either the keep sees the new flag, or the
 * create sees the keep (`answeredByDismissal`).
 */
export async function lockDuplicateAnswers(tx: DbTransaction, userId: string): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`dq-duplicate:${userId}`}))::text`
  );
}

/** Every copy a duplicate flag names: its own record and the copies it lists. */
export function duplicateIdSet(entityId: string, details: unknown): Set<string> | null {
  const parsed = duplicateCandidateDetailsSchema.safeParse(details);
  if (!parsed.success) return null;
  return new Set([entityId, ...parsed.data.copies.map((c) => c.entityId)]);
}

const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/**
 * The dismissed duplicate flag that already answers exactly these copies, or
 * null. A flag born answered records it (`resolution.inheritedFrom`), so an
 * undo of that answer re-opens the newcomer too.
 */
export async function answeredByDismissal(
  tx: DbTransaction,
  userId: string,
  entityType: string,
  ids: Set<string>
): Promise<string | null> {
  const dismissed = await tx.dataQualityFlag.findMany({
    where: {
      userId,
      kind: "duplicate_candidate",
      entityType,
      entityId: { in: [...ids] },
      status: "dismissed",
    },
    select: { id: true, entityId: true, details: true },
  });
  const match = dismissed.find((flag) => {
    const theirs = duplicateIdSet(flag.entityId, flag.details);
    return theirs !== null && sameSet(theirs, ids);
  });
  return match?.id ?? null;
}
