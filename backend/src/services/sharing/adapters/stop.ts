import type { DbTransaction } from "../../../db";
import type { Prisma, TripStop } from "../../../prisma";
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
  table: "flight" | "lodgingStay" | "cruise" | "railJourney" | "rentalBooking";
  key: string;
}

const REF_TABLES = ["flight", "lodgingStay", "cruise", "railJourney", "rentalBooking"] as const;

/** id → reference by share key, for every id that names a keyed entry. */
async function refsOf(c: DbTransaction, ids: string[]): Promise<Map<string, EntryRef>> {
  const out = new Map<string, EntryRef>();
  if (ids.length === 0) return out;
  const where = { id: { in: ids }, shareKey: { not: null } };
  const select = { id: true, shareKey: true } as const;
  const found: [EntryRef["table"], { id: string; shareKey: string | null }[]][] = [
    ["flight", await c.flight.findMany({ where, select })],
    ["lodgingStay", await c.lodgingStay.findMany({ where, select })],
    ["cruise", await c.cruise.findMany({ where, select })],
    ["railJourney", await c.railJourney.findMany({ where, select })],
    ["rentalBooking", await c.rentalBooking.findMany({ where, select })],
  ];
  for (const [table, rows] of found) {
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
  if (!ref || !REF_TABLES.includes(ref.table)) return null;
  const where = { userId_shareKey: { userId, shareKey: ref.key } };
  const select = { id: true } as const;
  const row =
    ref.table === "flight"
      ? await c.flight.findUnique({ where, select })
      : ref.table === "lodgingStay"
        ? await c.lodgingStay.findUnique({ where, select })
        : ref.table === "cruise"
          ? await c.cruise.findUnique({ where, select })
          : ref.table === "railJourney"
            ? await c.railJourney.findUnique({ where, select })
            : await c.rentalBooking.findUnique({ where, select });
  return row?.id ?? null;
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
  async copiesOf(c, shareKey) {
    const rows = await c.tripStop.findMany({ where: { shareKey }, include: INCLUDE });
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
