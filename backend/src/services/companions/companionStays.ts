import type { DbTransaction } from "../../db";
import { canonicalizeCompanionName } from "../../utils/companionName";

/**
 * Lodging stays name their companions as TEXT only — there is no join table.
 * A stay still puts a person on an entry, so it counts as a use (a person
 * named only on a stay is not "unused") and as an entry together.
 *
 * Matched by the catalogue's own identity rule (`canonicalizeCompanionName`)
 * against the caller's own catalogue: rename and merge rewrite these arrays,
 * so the match is deterministic for this user. A name with no catalogue row
 * belongs to nobody here and is ignored.
 */
export interface StayLinks {
  /** companion id → ids of the caller's stays that name them, planned and hidden ones included. */
  byCompanion: Map<string, Set<string>>;
}

export async function loadStayLinks(
  db: DbTransaction,
  userId: string,
  catalogue: readonly { id: string; canonicalName: string }[]
): Promise<StayLinks> {
  const byCanonical = new Map(catalogue.map((c) => [c.canonicalName, c.id]));
  const byCompanion = new Map<string, Set<string>>();
  if (byCanonical.size === 0) return { byCompanion };
  const stays = await db.lodgingStay.findMany({
    where: { userId, NOT: { companions: { isEmpty: true } } },
    select: { id: true, companions: true },
  });
  for (const stay of stays) {
    for (const name of stay.companions) {
      const id = byCanonical.get(canonicalizeCompanionName(name));
      if (!id) continue;
      const ids = byCompanion.get(id) ?? new Set<string>();
      ids.add(stay.id);
      byCompanion.set(id, ids);
    }
  }
  return { byCompanion };
}
