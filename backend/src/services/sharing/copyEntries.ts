import { randomUUID } from "crypto";

import type { DbTransaction } from "../../db";
import { deriveLodgingStatus } from "../../shared/statusDerivation";
import {
  cruiseFacts,
  cruiseLegFacts,
  cruiseStopFacts,
  flightFacts,
  lodgingFacts,
  isSameHouse,
  lodgingStayFacts,
  type HouseIdentity,
  railFacts,
  rentalFacts,
  stopFacts,
} from "./facts";

/**
 * Copying one shared trip's entries into another member's account (S1).
 *
 * Every function here takes the sharer's trip and the recipient's trip and
 * creates, in the recipient's account, the entries the recipient does not yet
 * hold — identified by `shareKey`, so running it twice creates nothing the
 * second time. Facts only (`./facts`); a copy is marked `dataSource: "shared"`.
 * Every write names `userId: recipientId` explicitly — the copy is the
 * recipient's row from its first moment, counted by their statistics alone.
 */

export interface CopyContext {
  tx: DbTransaction;
  ownerId: string;
  ownerTripId: string;
  recipientId: string;
  recipientTripId: string;
  /** Sharer's entry id → recipient's entry id, across all types; read by stops. */
  idMap: Map<string, string>;
}

export interface CopyCounts {
  flights: number;
  lodgingStays: number;
  cruises: number;
  railJourneys: number;
  rentals: number;
  stops: number;
}

export const SHARED_SOURCE = "shared";

/**
 * Give every entry of the sharer's trip a key, if it has none yet (first
 * share). One update per row: each needs its own uuid.
 */
export async function assignShareKeys(tx: DbTransaction, ownerId: string, tripId: string) {
  const where = { tripId, userId: ownerId, shareKey: null };
  const keyed = async (rows: { id: string }[], update: (id: string) => Promise<unknown>) => {
    for (const row of rows) await update(row.id);
  };
  const key = () => ({ shareKey: randomUUID() });
  await keyed(await tx.flight.findMany({ where, select: { id: true } }), (id) =>
    tx.flight.update({ where: { id }, data: key() })
  );
  await keyed(await tx.lodgingStay.findMany({ where, select: { id: true } }), (id) =>
    tx.lodgingStay.update({ where: { id }, data: key() })
  );
  await keyed(await tx.cruise.findMany({ where, select: { id: true } }), (id) =>
    tx.cruise.update({ where: { id }, data: key() })
  );
  await keyed(await tx.railJourney.findMany({ where, select: { id: true } }), (id) =>
    tx.railJourney.update({ where: { id }, data: key() })
  );
  await keyed(await tx.rentalBooking.findMany({ where, select: { id: true } }), (id) =>
    tx.rentalBooking.update({ where: { id }, data: key() })
  );
  await keyed(
    await tx.tripStop.findMany({
      where: { tripId, shareKey: null, routeId: null, viaPoint: false },
      select: { id: true },
    }),
    (id) => tx.tripStop.update({ where: { id }, data: key() })
  );
}

/** Which of `keys` the recipient already holds, as key → their row id. */
function held(rows: { id: string; shareKey: string | null }[]): Map<string, string> {
  return new Map(rows.flatMap((r) => (r.shareKey ? [[r.shareKey, r.id] as const] : [])));
}

/** Rows of the sharer's trip with a key, in a stable order. */
const ownerWhere = (ctx: CopyContext) => ({
  tripId: ctx.ownerTripId,
  userId: ctx.ownerId,
  shareKey: { not: null },
});
const recipientWhere = (ctx: CopyContext, keys: string[]) => ({
  userId: ctx.recipientId,
  shareKey: { in: keys },
});
const keysOf = (rows: { shareKey: string | null }[]) =>
  rows.flatMap((r) => (r.shareKey ? [r.shareKey] : []));

export async function copyFlights(ctx: CopyContext): Promise<number> {
  const { tx } = ctx;
  const rows = await tx.flight.findMany({ where: ownerWhere(ctx), orderBy: { id: "asc" } });
  const have = held(
    await tx.flight.findMany({
      where: recipientWhere(ctx, keysOf(rows)),
      select: { id: true, shareKey: true },
    })
  );
  let created = 0;
  for (const row of rows) {
    const key = row.shareKey as string;
    const existing = have.get(key);
    if (existing) {
      ctx.idMap.set(row.id, existing);
      continue;
    }
    const copy = await tx.flight.create({
      data: {
        ...flightFacts(row),
        userId: ctx.recipientId,
        tripId: ctx.recipientTripId,
        shareKey: key,
        dataSource: SHARED_SOURCE,
      },
      select: { id: true },
    });
    ctx.idMap.set(row.id, copy.id);
    created += 1;
  }
  return created;
}

/**
 * The recipient's house for a stay: their own lodging when it is the SAME
 * house (`isSameHouse` — name and place), otherwise a new one carrying the
 * house's facts. A chain is kept only when it is a catalogue chain — a chain
 * the sharer created is their row, and the recipient's lodging must not point
 * at it.
 */
async function recipientLodgingId(
  ctx: CopyContext,
  ownerLodgingId: string,
  cache: Map<string, string>,
  candidates: (HouseIdentity & { id: string })[]
): Promise<string> {
  const cached = cache.get(ownerLodgingId);
  if (cached) return cached;
  const lodging = await ctx.tx.lodging.findUniqueOrThrow({
    where: { id: ownerLodgingId },
    include: { chain: { select: { userId: true } } },
  });
  let id = candidates.find((c) => isSameHouse(lodging, c))?.id;
  if (!id) {
    const created = await ctx.tx.lodging.create({
      data: {
        ...lodgingFacts(lodging),
        userId: ctx.recipientId,
        chainId: lodging.chain && lodging.chain.userId === null ? lodging.chainId : null,
        dataSource: SHARED_SOURCE,
      },
      select: {
        id: true,
        name: true,
        lat: true,
        lon: true,
        city: true,
        country: true,
        isoCountryCode: true,
      },
    });
    id = created.id;
    candidates.push(created);
  }
  cache.set(ownerLodgingId, id);
  return id;
}

export async function copyLodgingStays(ctx: CopyContext): Promise<number> {
  const { tx } = ctx;
  const rows = await tx.lodgingStay.findMany({ where: ownerWhere(ctx), orderBy: { id: "asc" } });
  const have = held(
    await tx.lodgingStay.findMany({
      where: recipientWhere(ctx, keysOf(rows)),
      select: { id: true, shareKey: true },
    })
  );
  const candidates: (HouseIdentity & { id: string })[] = await tx.lodging.findMany({
    where: { userId: ctx.recipientId },
    select: {
      id: true,
      name: true,
      lat: true,
      lon: true,
      city: true,
      country: true,
      isoCountryCode: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const cache = new Map<string, string>();
  let created = 0;
  for (const row of rows) {
    const key = row.shareKey as string;
    const existing = have.get(key);
    if (existing) {
      ctx.idMap.set(row.id, existing);
      continue;
    }
    const copy = await tx.lodgingStay.create({
      data: {
        ...lodgingStayFacts(row),
        // The column is a cache of the dates (`shared/statusDerivation.ts`);
        // derived afresh for the copy rather than trusted as stored.
        status: deriveLodgingStatus({
          checkIn: row.checkIn,
          checkOut: row.checkOut,
          current: row.status,
        }),
        lodgingId: await recipientLodgingId(ctx, row.lodgingId, cache, candidates),
        userId: ctx.recipientId,
        tripId: ctx.recipientTripId,
        shareKey: key,
        dataSource: SHARED_SOURCE,
      },
      select: { id: true },
    });
    ctx.idMap.set(row.id, copy.id);
    created += 1;
  }
  return created;
}

export async function copyCruises(ctx: CopyContext): Promise<number> {
  const { tx } = ctx;
  const rows = await tx.cruise.findMany({
    where: ownerWhere(ctx),
    include: { stops: { orderBy: { dayNumber: "asc" } }, legs: { orderBy: { ordinal: "asc" } } },
    orderBy: { id: "asc" },
  });
  const have = held(
    await tx.cruise.findMany({
      where: recipientWhere(ctx, keysOf(rows)),
      select: { id: true, shareKey: true },
    })
  );
  let created = 0;
  for (const row of rows) {
    const key = row.shareKey as string;
    const existing = have.get(key);
    if (existing) {
      ctx.idMap.set(row.id, existing);
      continue;
    }
    const copy = await tx.cruise.create({
      data: {
        ...cruiseFacts(row),
        userId: ctx.recipientId,
        tripId: ctx.recipientTripId,
        shareKey: key,
        dataSource: SHARED_SOURCE,
        stops: { create: row.stops.map((s) => cruiseStopFacts(s)) },
        legs: { create: row.legs.map((l) => cruiseLegFacts(l)) },
      },
      select: { id: true },
    });
    ctx.idMap.set(row.id, copy.id);
    created += 1;
  }
  return created;
}

export async function copyRailJourneys(ctx: CopyContext): Promise<number> {
  const { tx } = ctx;
  const rows = await tx.railJourney.findMany({ where: ownerWhere(ctx), orderBy: { id: "asc" } });
  const have = held(
    await tx.railJourney.findMany({
      where: recipientWhere(ctx, keysOf(rows)),
      select: { id: true, shareKey: true },
    })
  );
  let created = 0;
  for (const row of rows) {
    const key = row.shareKey as string;
    const existing = have.get(key);
    if (existing) {
      ctx.idMap.set(row.id, existing);
      continue;
    }
    const copy = await tx.railJourney.create({
      data: {
        ...railFacts(row),
        userId: ctx.recipientId,
        tripId: ctx.recipientTripId,
        shareKey: key,
      },
      select: { id: true },
    });
    ctx.idMap.set(row.id, copy.id);
    created += 1;
  }
  return created;
}

export async function copyRentals(ctx: CopyContext): Promise<number> {
  const { tx } = ctx;
  const rows = await tx.rentalBooking.findMany({ where: ownerWhere(ctx), orderBy: { id: "asc" } });
  const have = held(
    await tx.rentalBooking.findMany({
      where: recipientWhere(ctx, keysOf(rows)),
      select: { id: true, shareKey: true },
    })
  );
  let created = 0;
  for (const row of rows) {
    const key = row.shareKey as string;
    const existing = have.get(key);
    if (existing) {
      ctx.idMap.set(row.id, existing);
      continue;
    }
    const copy = await tx.rentalBooking.create({
      data: {
        ...rentalFacts(row),
        userId: ctx.recipientId,
        tripId: ctx.recipientTripId,
        shareKey: key,
      },
      select: { id: true },
    });
    ctx.idMap.set(row.id, copy.id);
    created += 1;
  }
  return created;
}

/**
 * Timeline stops, after every other type: a stop that wraps an entry
 * (`sourceId`) or names a stay is re-pointed at the recipient's copy of it,
 * and left unwrapped when that entry was not copied. Roadtrip stations and
 * route corrections are not timeline stops and stay behind (S1 copies no
 * roadtrip).
 */
export async function copyStops(ctx: CopyContext): Promise<number> {
  const { tx } = ctx;
  const rows = await tx.tripStop.findMany({
    where: { tripId: ctx.ownerTripId, shareKey: { not: null }, routeId: null, viaPoint: false },
    orderBy: [{ orderIdx: "asc" }, { id: "asc" }],
  });
  const have = held(
    await tx.tripStop.findMany({
      where: { tripId: ctx.recipientTripId, shareKey: { in: keysOf(rows) } },
      select: { id: true, shareKey: true },
    })
  );
  let created = 0;
  for (const row of rows) {
    const key = row.shareKey as string;
    if (have.has(key)) continue;
    await tx.tripStop.create({
      data: {
        ...stopFacts(row),
        tripId: ctx.recipientTripId,
        sourceId: row.sourceId ? (ctx.idMap.get(row.sourceId) ?? null) : null,
        lodgingStayId: row.lodgingStayId ? (ctx.idMap.get(row.lodgingStayId) ?? null) : null,
        shareKey: key,
      },
    });
    created += 1;
  }
  return created;
}
