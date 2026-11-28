/**
 * One-sided entries in a link (owner decision, 2026-11-28). An entry only one copy holds is NEVER
 * added silently: the dry run lists it ("nur bei …", unticked by default), and only the refs the
 * person ticked (`add`) are created on the other side — with the link's share key, so they sync
 * from then on. The bulk run never sends `add`. What a link added is remembered, and the undo
 * (leaving the group) removes it again.
 */
import { randomUUID } from "crypto";
import { z } from "zod";

import type { DbTransaction } from "../../db";
import { ADAPTERS } from "./adapters";
import { type LinkPlan, type LinkRow } from "./linkMatch";
import { oneSidedRef } from "./linkDuplicates";
import { spreadCreate, spreadRemoval } from "./propagate";
import { SHARE_ENTITIES, SHARE_TYPES } from "./shareTypes";

/** A copy row a confirmed addition created: where, and when (to tell an edited copy apart). */
const copySchema = z.strictObject({
  id: z.string(),
  userId: z.string(),
  tripId: z.string(),
  at: z.string(),
});

/**
 * One entry a link added: its type, its key, whose original it is, and the exact copy rows the link
 * created on this server (security review: an undo deletes only those, and only in the acting
 * person's own trip). A home entry ticked across servers arrives later by the home's entries; its
 * copy is then found by key in the person's own trip, never elsewhere.
 */
export const addedEntrySchema = z.strictObject({
  entity: z.enum(SHARE_ENTITIES),
  key: z.string(),
  ownerId: z.string(),
  copies: z.array(copySchema).optional(),
});
export type AddedEntry = z.infer<typeof addedEntrySchema>;
export const addedListSchema = z.array(addedEntrySchema);

const spreadBy = (actorId: string, groupId: string) => ({
  groupId,
  author: { kind: "user" as const, id: actorId },
  via: [actorId],
  fromOrigin: null,
});

interface RowDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    select: { id: true; tripId: true; createdAt: true; updatedAt: true };
  }): Promise<{ id: string; tripId: string | null; createdAt: Date; updatedAt: Date }[]>;
  findFirst(args: {
    where: Record<string, unknown>;
    select: { id: true };
  }): Promise<{ id: string } | null>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
}
const delegateOf = (tx: DbTransaction, entity: AddedEntry["entity"]) =>
  (tx as unknown as Record<string, RowDelegate>)[SHARE_TYPES[entity].delegate];

/**
 * Key one ticked one-sided entry and spread it as new into the group: a copy for every member here
 * and a create message for every server. `ownerId` holds the original; the copies made here are
 * recorded by id.
 */
export async function addOneSided(
  tx: DbTransaction,
  ownerId: string,
  groupId: string,
  row: LinkRow
): Promise<AddedEntry> {
  const adapter = ADAPTERS[row.entity];
  const key = row.row.shareKey ?? randomUUID();
  const trips = await tx.trip.findMany({
    where: { shareGroupId: groupId, userId: { not: ownerId } },
    select: { id: true, userId: true },
  });
  const ownerOf = new Map(trips.map((t) => [t.id, t.userId]));
  const delegate = delegateOf(tx, row.entity);
  const copiesNow = () =>
    delegate.findMany({
      where: { shareKey: key, tripId: { in: [...ownerOf.keys()] } },
      select: { id: true, tripId: true, createdAt: true, updatedAt: true },
    });
  // Copies of that key that existed before (an entry already shared elsewhere) are not this
  // link's: only rows it creates are recorded, and only those an undo may remove (Codex P2).
  const before = new Set((await copiesNow()).map((c) => c.id));
  if (!row.row.shareKey) await adapter.setKey(tx, row.row.id, key);
  await spreadCreate(tx, adapter, spreadBy(ownerId, groupId), { ...row.row, shareKey: key });
  const made = (await copiesNow()).filter((c) => !before.has(c.id));
  return {
    entity: row.entity,
    key,
    ownerId,
    copies: made.map((c) => ({
      id: c.id,
      userId: ownerOf.get(c.tripId as string) as string,
      tripId: c.tripId as string,
      at: c.updatedAt.toISOString(),
    })),
  };
}

/** The one-sided rows of a plan the person ticked, each with the account that holds it. */
export function tickedRows(
  plan: LinkPlan,
  add: readonly string[] | undefined,
  hereOwner: string,
  thereOwner: string | null
): { owner: string | null; row: LinkRow }[] {
  if (!add || add.length === 0) return [];
  const wanted = new Set(add);
  return [
    ...plan.onlyHere
      .filter((r) => wanted.has(oneSidedRef(r)))
      .map((row) => ({ owner: hereOwner, row })),
    ...plan.onlyThere
      .filter((r) => wanted.has(oneSidedRef(r)))
      .map((row) => ({ owner: thereOwner, row })),
  ];
}

/**
 * A home entry's copy across servers is not recorded by id (it arrives after the link) and is
 * judged by its own creation, which the copy path stamps within a moment of its update time.
 */
const ARRIVAL_GRACE_MS = 1_000;

/**
 * Undo what a link added, before the acting person's trip leaves the group. Only in THEIR OWN trip
 * (security review): the copy rows the link created there are deleted — unless saved since, which
 * is kept with a notice. Their own entries the link added elsewhere are never deleted in another
 * person's trip; those members (here and on other servers) are told they were deleted, and decide.
 */
export async function undoAdditions(
  tx: DbTransaction,
  userId: string,
  groupId: string,
  ownTripId: string,
  added: readonly AddedEntry[]
): Promise<number> {
  let removed = 0;
  for (const a of added) {
    const delegate = delegateOf(tx, a.entity);
    if (a.ownerId === userId) {
      const own = await delegate.findFirst({
        where: { shareKey: a.key, tripId: ownTripId },
        select: { id: true },
      });
      if (own) {
        const adapter = ADAPTERS[a.entity];
        const [row] = await adapter.load(tx, [own.id]);
        if (row) await spreadRemoval(tx, adapter, spreadBy(userId, groupId), row, "deleted");
      }
      continue;
    }
    const recorded = (a.copies ?? []).filter((c) => c.tripId === ownTripId && c.userId === userId);
    // Across servers the home's entry arrived after the link: its copy is the row of that key in
    // the person's own trip, judged by its own creation time.
    const rows = await delegate.findMany({
      where: {
        tripId: ownTripId,
        ...(a.copies ? { id: { in: recorded.map((c) => c.id) } } : { shareKey: a.key }),
      },
      select: { id: true, tripId: true, createdAt: true, updatedAt: true },
    });
    for (const r of rows) {
      const rec = recorded.find((c) => c.id === r.id);
      // A recorded copy is unedited only at exactly the version the link wrote (Codex P2).
      const edited = rec
        ? r.updatedAt.getTime() !== new Date(rec.at).getTime()
        : r.updatedAt.getTime() > r.createdAt.getTime() + ARRIVAL_GRACE_MS;
      if (edited) {
        await tx.shareNotice.create({
          data: {
            userId,
            groupId,
            kind: "conflict",
            entityType: a.entity,
            entityKey: a.key,
            after: { keptAfterUndo: true, entryId: r.id },
          },
        });
        continue;
      }
      // Exactly the row this link added, in the acting person's own trip.
      const gone = await delegate.deleteMany({ where: { id: r.id, tripId: ownTripId } });
      removed += gone.count;
    }
  }
  return removed;
}

/**
 * What links in this trip's group added that involve the caller: the local link's notice (to the
 * other account, by the caller or to them) and, across servers, the caller's linked membership.
 */
export async function linkAdditionsOf(
  tx: DbTransaction,
  userId: string,
  trip: { id: string; shareGroupId: string | null }
): Promise<AddedEntry[]> {
  const groupId = trip.shareGroupId;
  if (!groupId) return [];
  const [notices, memberships] = await Promise.all([
    tx.shareNotice.findMany({
      where: {
        groupId,
        kind: "shared",
        entityType: "trip",
        OR: [{ actorId: userId }, { userId }],
      },
      select: { after: true },
    }),
    tx.tripShareRemoteMember.findMany({
      where: { groupId, remote: { userId } },
      select: { offer: true },
    }),
  ]);
  const lists = [
    ...notices.map((n) => (n.after as { linkAdded?: unknown } | null)?.linkAdded),
    ...memberships
      .map((m) => (m.offer as { linked?: { tripId?: string; added?: unknown } } | null)?.linked)
      .flatMap((l) => (l && l.tripId === trip.id ? [l.added] : [])),
  ];
  return lists.flatMap((l) => {
    const parsed = addedListSchema.safeParse(l ?? []);
    return parsed.success ? parsed.data : [];
  });
}
