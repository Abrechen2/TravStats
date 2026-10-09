import type { Db as Client, DbTransaction } from "../../db";

/** The client or a transaction — every helper works inside a merge's transaction too. */
type Db = Client | DbTransaction;

/**
 * The ONE answer to "does this user already have a place for source reference
 * X?" (forgejo#232, review I1).
 *
 * A place answers to its own `externalRef` AND to the aliases a merge left on
 * it (`PlaceExternalRef`). Asking only the column was right until merges
 * existed; after one, the folded place's reference lives in the alias table,
 * and a dedup that asked the column alone created the duplicate the merge had
 * removed. Every dedup path asks here: the manual create, the import preview
 * and commit, the photo-finding accept, the names backfill, and the edit that
 * writes a reference.
 */
export async function findPlaceIdByRef(
  db: Db,
  userId: string,
  ref: string
): Promise<string | null> {
  const [primary, alias] = await Promise.all([
    db.place.findFirst({ where: { userId, externalRef: ref }, select: { id: true } }),
    db.placeExternalRef.findUnique({
      where: { userId_ref: { userId, ref } },
      select: { placeId: true },
    }),
  ]);
  return primary?.id ?? alias?.placeId ?? null;
}

/** Whether a place OTHER than `placeId` already answers to `ref`. */
export async function refHeldElsewhere(
  db: Db,
  userId: string,
  ref: string,
  placeId: string
): Promise<boolean> {
  const holder = await findPlaceIdByRef(db, userId, ref);
  return holder !== null && holder !== placeId;
}

/** Every reference the user's places answer to → the place — for a batch of lookups. */
export async function placeRefIndex(db: Db, userId: string): Promise<Map<string, string>> {
  const [primaries, aliases] = await Promise.all([
    db.place.findMany({
      where: { userId, externalRef: { not: null } },
      select: { id: true, externalRef: true },
    }),
    db.placeExternalRef.findMany({ where: { userId }, select: { ref: true, placeId: true } }),
  ]);
  const index = new Map<string, string>();
  for (const a of aliases) index.set(a.ref, a.placeId);
  for (const p of primaries) if (p.externalRef) index.set(p.externalRef, p.id);
  return index;
}

/**
 * Inside a merge: everything the folded place answered to moves to the place
 * that stays. Its aliases are re-pointed (a chain of merges keeps every
 * reference), and the references neither place keeps as its primary become
 * aliases of the one that stays.
 */
export async function carryRefsIntoMerge(
  tx: Db,
  userId: string,
  keptId: string,
  foldedId: string,
  refsToAlias: readonly string[]
): Promise<void> {
  await tx.placeExternalRef.updateMany({
    where: { userId, placeId: foldedId },
    data: { placeId: keptId },
  });
  const distinct = [...new Set(refsToAlias)];
  if (distinct.length > 0) {
    // `skipDuplicates`: a reference the kept place already answers to as an
    // alias stays one row — a second insert must never make the whole merge
    // fail on the unique index (re-review N1).
    await tx.placeExternalRef.createMany({
      data: distinct.map((ref) => ({ userId, placeId: keptId, ref })),
      skipDuplicates: true,
    });
  }
}

/**
 * An edit that makes one of a place's OWN aliases its primary reference swaps
 * the two: the alias row goes (a value is never both primary and alias of one
 * place — a later merge would insert it twice), and the old primary, if there
 * was one, stays as an alias so nothing the place answered to is lost
 * (re-review N1). A reference that is not one of the place's aliases changes
 * nothing here: a new pick is a new identity, as before.
 */
export async function promoteOwnAlias(
  tx: Db,
  userId: string,
  placeId: string,
  oldPrimary: string | null,
  newPrimary: string
): Promise<void> {
  const own = await tx.placeExternalRef.findFirst({
    where: { userId, placeId, ref: newPrimary },
    select: { id: true },
  });
  if (!own) return;
  await tx.placeExternalRef.delete({ where: { id: own.id } });
  if (oldPrimary !== null && oldPrimary !== newPrimary) {
    await tx.placeExternalRef.createMany({
      data: [{ userId, placeId, ref: oldPrimary }],
      skipDuplicates: true,
    });
  }
}
