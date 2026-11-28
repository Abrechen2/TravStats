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

/** One entry a link added: its type, its key, and whose original it is. */
export const addedEntrySchema = z.strictObject({
  entity: z.enum(SHARE_ENTITIES),
  key: z.string(),
  ownerId: z.string(),
});
export type AddedEntry = z.infer<typeof addedEntrySchema>;
export const addedListSchema = z.array(addedEntrySchema);

const spreadBy = (actorId: string, groupId: string) => ({
  groupId,
  author: { kind: "user" as const, id: actorId },
  via: [actorId],
  fromOrigin: null,
});

/**
 * Key one ticked one-sided entry and spread it as new into the group: a copy for every member here
 * and a create message for every server. `ownerId` holds the original.
 */
export async function addOneSided(
  tx: DbTransaction,
  ownerId: string,
  groupId: string,
  row: LinkRow
): Promise<AddedEntry> {
  const adapter = ADAPTERS[row.entity];
  const key = row.row.shareKey ?? randomUUID();
  if (!row.row.shareKey) await adapter.setKey(tx, row.row.id, key);
  await spreadCreate(tx, adapter, spreadBy(ownerId, groupId), { ...row.row, shareKey: key });
  return { entity: row.entity, key, ownerId };
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
 * Undo what a link added, before the caller's trip leaves the group: on this server every COPY of
 * an added entry (rows holding its key in the group's trips, not the original's owner) is deleted;
 * an added entry of the caller's own that went to another server is reported there as deleted.
 */
export async function undoAdditions(
  tx: DbTransaction,
  userId: string,
  groupId: string,
  added: readonly AddedEntry[]
): Promise<number> {
  if (added.length === 0) return 0;
  const trips = await tx.trip.findMany({
    where: { shareGroupId: groupId },
    select: { id: true, userId: true },
  });
  let removed = 0;
  for (const a of added) {
    // Copies live in the other members' trips; the original stays where its owner put it.
    const copyTrips = trips.filter((t) => t.userId !== a.ownerId).map((t) => t.id);
    const ownTrips = trips.filter((t) => t.userId === a.ownerId).map((t) => t.id);
    const delegate = (tx as unknown as Record<string, DeleteDelegate>)[
      SHARE_TYPES[a.entity].delegate
    ];
    // Only copies this link itself created go; the original's owner keeps theirs.
    const gone = await delegate.deleteMany({
      where: { shareKey: a.key, tripId: { in: copyTrips } },
    });
    removed += gone.count;
    if (a.ownerId === userId) {
      const adapter = ADAPTERS[a.entity];
      const own = await delegate.findFirst({
        where: { shareKey: a.key, tripId: { in: ownTrips } },
        select: { id: true },
      });
      if (own) {
        const [row] = await adapter.load(tx, [own.id]);
        if (row) await spreadRemoval(tx, adapter, spreadBy(userId, groupId), row, "deleted");
      }
    }
  }
  return removed;
}

interface DeleteDelegate {
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  findFirst(args: {
    where: Record<string, unknown>;
    select: { id: true };
  }): Promise<{ id: string } | null>;
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
