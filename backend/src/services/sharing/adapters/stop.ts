import type { DbTransaction } from "../../../db";
import type { Prisma, TripStop } from "../../../prisma";
import { REF_DELEGATES, delegateOf, findByUserKey } from "../keyOps";
import type { ShareDelegate } from "../shareTypes";
import { STOP_FACT_FIELDS, pickFacts, stopFacts, type StopFactField } from "../facts";
import { plainData, type EntityAdapter, type SharedRow } from "./types";

/**
 * A timeline stop. It has no user column — its trip's owner owns it — and it
 * may wrap another entry (`sourceId`) or name a stay (`lodgingStayId`). Those
 * ids are the owner's own rows, so they travel as references by share key
 * (`sourceRef`, `lodgingStayRef`) and are resolved in each account to that
 * account's copy — or to nothing, where the account holds none.
 */

export interface EntryRef {
  table: ShareDelegate;
  key: string;
}

/** id → reference by share key, for every id that names a keyed entry. */
async function refsOf(c: DbTransaction, ids: string[]): Promise<Map<string, EntryRef>> {
  const out = new Map<string, EntryRef>();
  if (ids.length === 0) return out;
  for (const table of REF_DELEGATES) {
    const rows = await delegateOf(c, table).findMany({
      where: { id: { in: ids }, shareKey: { not: null } },
      select: { id: true, shareKey: true },
    });
    for (const row of rows) if (row.shareKey) out.set(row.id, { table, key: row.shareKey });
  }
  return out;
}

/** The id of `userId`'s own copy behind `ref`, or null. */
async function resolveRef(
  c: DbTransaction,
  ref: EntryRef | null | undefined,
  userId: string
): Promise<string | null> {
  if (!ref || !REF_DELEGATES.includes(ref.table)) return null;
  return (await findByUserKey(c, ref.table, userId, ref.key))?.id ?? null;
}

type StopWithTrip = TripStop & { trip: { userId: string } | null };

async function stopRows(c: DbTransaction, rows: StopWithTrip[]): Promise<SharedRow[]> {
  const refIds = rows.flatMap((r) => [r.sourceId, r.lodgingStayId]).filter(Boolean) as string[];
  const refs = await refsOf(c, refIds);
  return rows.flatMap((row) =>
    row.trip
      ? [
          {
            id: row.id,
            userId: row.trip.userId,
            tripId: row.tripId,
            shareKey: row.shareKey,
            facts: {
              ...pickFacts(row, STOP_FACT_FIELDS),
              sourceRef: (row.sourceId && refs.get(row.sourceId)) || null,
              lodgingStayRef: (row.lodgingStayId && refs.get(row.lodgingStayId)) || null,
            },
            label: row.title,
            zones: { startUtc: row.stopZone, endUtc: row.stopZone },
            excluded: row.routeId !== null || row.viaPoint,
          },
        ]
      : []
  );
}

const INCLUDE = { trip: { select: { userId: true } } } as const;

export const stopAdapter: EntityAdapter = {
  entity: "stop",
  fields: [...STOP_FACT_FIELDS, "sourceRef", "lodgingStayRef"],
  async load(c, ids) {
    const rows = await c.tripStop.findMany({ where: { id: { in: [...ids] } }, include: INCLUDE });
    return stopRows(c, rows);
  },
  async copiesOf(c, shareKey, groupId) {
    const rows = await c.tripStop.findMany({
      where: { shareKey, trip: { shareGroupId: groupId } },
      include: INCLUDE,
    });
    return stopRows(c, rows);
  },
  async setKey(c, id, key) {
    await c.tripStop.update({ where: { id }, data: { shareKey: key } });
  },
  async createCopy(c, source, recipientId, recipientTripId) {
    const copy = await c.tripStop.create({
      data: {
        ...stopFacts(source.facts as Pick<TripStop, StopFactField>),
        tripId: recipientTripId,
        sourceId: await resolveRef(c, source.facts.sourceRef as EntryRef | null, recipientId),
        lodgingStayId: await resolveRef(
          c,
          source.facts.lodgingStayRef as EntryRef | null,
          recipientId
        ),
        shareKey: source.shareKey,
      },
      select: { id: true },
    });
    return copy.id;
  },
  async apply(c, copy, values, keys) {
    const data = plainData(values, keys, STOP_FACT_FIELDS) as Prisma.TripStopUncheckedUpdateInput;
    if (keys.includes("sourceRef")) {
      data.sourceId = await resolveRef(c, values.sourceRef as EntryRef | null, copy.userId);
    }
    if (keys.includes("lodgingStayRef")) {
      data.lodgingStayId = await resolveRef(
        c,
        values.lodgingStayRef as EntryRef | null,
        copy.userId
      );
    }
    if (Object.keys(data).length > 0) await c.tripStop.update({ where: { id: copy.id }, data });
  },
  async remove(c, id) {
    await c.tripStop.delete({ where: { id } });
  },
};
