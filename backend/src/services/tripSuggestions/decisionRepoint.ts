import type { DbTransaction } from "../../db";

/**
 * Keep trip-suggestion answers pointing at records that still exist.
 *
 * An answer names its members (`flight:<id>`) and, for a place visit, its place.
 * A merge deletes the copy those ids belong to; without re-pointing, the answer
 * names nothing, the kept record looks unanswered, and the question comes back.
 */

/** Members of answers that named a removed copy now name the kept record. */
export async function repointDecisionMembers(
  tx: DbTransaction,
  userId: string,
  domainPrefix: string,
  keptId: string,
  removedIds: readonly string[]
): Promise<void> {
  const removedKeys = removedIds.map((id) => `${domainPrefix}:${id}`);
  const keptKey = `${domainPrefix}:${keptId}`;
  const rows = await tx.tripSuggestionDecision.findMany({
    where: { userId, memberKeys: { hasSome: removedKeys } },
    select: { id: true, memberKeys: true, memberContentKeys: true },
  });
  for (const row of rows) {
    const keys: string[] = [];
    const contents: string[] = [];
    row.memberKeys.forEach((key, i) => {
      const next = removedKeys.includes(key) ? keptKey : key;
      if (keys.includes(next)) return;
      keys.push(next);
      const content = row.memberContentKeys[i];
      if (content !== undefined) contents.push(content);
    });
    await tx.tripSuggestionDecision.update({
      where: { id: row.id },
      data: { memberKeys: keys, memberContentKeys: row.memberContentKeys.length ? contents : [] },
    });
  }
}

/** Answers about a place that was merged away now name the place that stayed. */
export async function repointDecisionPlace(
  tx: DbTransaction,
  userId: string,
  fromPlaceId: string,
  toPlaceId: string
): Promise<number> {
  const moved = await tx.tripSuggestionDecision.updateMany({
    where: { userId, kind: "place_visit", targetId: fromPlaceId },
    data: { targetId: toPlaceId },
  });
  return moved.count;
}
