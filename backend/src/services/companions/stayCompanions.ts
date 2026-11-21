import { prisma, type DbTransaction } from "../../db";
import { planCompanions } from "../companionService";

/**
 * A lodging stay names its people as text (`LodgingStay.companions`). Per-person
 * facts and the document picker (plan D7) need a catalogue row for each, so a
 * name that has none gets one — by the same canonical-name identity flights use.
 * Create-only: an existing companion keeps its spelling (`upsertPlannedCompanions`
 * would overwrite the display name with the stay's).
 */
export async function ensureStayCompanions(
  db: Pick<DbTransaction, "companion">,
  userId: string,
  names: readonly string[]
): Promise<number> {
  const planned = planCompanions([...names]);
  if (planned.length === 0) return 0;
  const { count } = await db.companion.createMany({
    data: planned.map((p) => ({ userId, ...p })),
    skipDuplicates: true,
  });
  return count;
}

/** Once for every stay that exists: gives each text-only stay person a catalogue row. Idempotent. */
export async function backfillStayCompanions(): Promise<number> {
  let created = 0;
  const byUser = new Map<string, Set<string>>();
  let cursor: string | undefined;
  for (;;) {
    const stays = await prisma.lodgingStay.findMany({
      where: { NOT: { companions: { isEmpty: true } } },
      select: { id: true, userId: true, companions: true },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (stays.length === 0) break;
    for (const s of stays) {
      const set = byUser.get(s.userId) ?? new Set<string>();
      s.companions.forEach((n) => set.add(n));
      byUser.set(s.userId, set);
    }
    cursor = stays[stays.length - 1].id;
    if (stays.length < 500) break;
  }
  for (const [userId, names] of byUser) {
    created += await ensureStayCompanions(prisma, userId, [...names]);
  }
  return created;
}
