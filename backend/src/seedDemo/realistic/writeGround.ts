import { prisma } from "../../db";
import { deriveLodgingStatus } from "../../shared/statusDerivation";
import { seedFxColumns } from "../stayFx";
import { LODGINGS } from "./data/lodgings";
import type { PlaceSpec, StaySpec } from "./data/types";
import type { SeedContext } from "./context";
import { addDays } from "./time";

/**
 * Where the demo traveller slept and what they saw. A house or a sight that
 * comes back on a later trip is ONE row with a second stay or visit — which is
 * what "stayed there three times" and "visited twice" count.
 */

/** Stays of one trip, keyed `lodging@checkInDay`, for roadtrip stations to point at. */
export type StayIndex = Map<string, string>;

export const stayKey = (lodging: string, inDay: number): string => `${lodging}@${inDay}`;

async function lodgingId(ctx: SeedContext, key: StaySpec["lodging"]): Promise<string> {
  const known = ctx.lodgingIds.get(key);
  if (known) return known;
  const spec = LODGINGS[key];
  const chainId = spec.chain ? (ctx.chainIdByName.get(spec.chain) ?? null) : null;
  const row = await prisma.lodging.create({
    data: {
      userId: ctx.userId,
      type: spec.type,
      name: spec.name,
      chainId,
      address: spec.address,
      city: spec.city,
      country: spec.country,
      isoCountryCode: spec.iso,
      lat: spec.lat,
      lon: spec.lon,
      stars: spec.stars,
      // A booked house, planned or past: whether the stay has happened is the
      // dates' answer, not this flag's (finding B3, review 2026-09-17).
      visited: true,
      dataSource: "manual",
    },
  });
  ctx.lodgingIds.set(key, row.id);
  return row.id;
}

export async function writeStays(
  ctx: SeedContext,
  tripId: string | null,
  day: Date,
  specs: readonly StaySpec[],
  companions: readonly string[]
): Promise<StayIndex> {
  const index: StayIndex = new Map();
  for (const spec of specs) {
    const checkIn = addDays(day, spec.in);
    const checkOut = addDays(day, spec.in + spec.nights);
    const membershipId = spec.loyalty
      ? (ctx.membershipIdByProgram.get(spec.loyalty) ?? null)
      : null;
    const row = await prisma.lodgingStay.create({
      data: {
        userId: ctx.userId,
        lodgingId: await lodgingId(ctx, spec.lodging),
        tripId,
        checkIn,
        checkOut,
        checkInTime: "15:00",
        checkOutTime: "11:00",
        datePrecision: "DAY",
        nights: spec.nights,
        status: deriveLodgingStatus({ checkIn, checkOut, current: "completed", now: ctx.now }),
        board: spec.board,
        guests: 1 + companions.length,
        roomCategory: spec.room ?? null,
        currency: spec.currency,
        totalPrice: spec.price,
        pricePerNight:
          spec.price === null ? null : Math.round((spec.price / spec.nights) * 100) / 100,
        ...seedFxColumns(
          { totalPrice: spec.price, currency: spec.currency, checkIn },
          ctx.baseCurrency
        ),
        isAwardStay: spec.award ?? false,
        ratingOverall: spec.rating ?? null,
        membershipId,
        companions: [...companions],
        notes: spec.notes ?? null,
        dataSource: "manual",
      },
    });
    index.set(stayKey(spec.lodging, spec.in), row.id);
  }
  return index;
}

/** One sight is one row, however often it is visited: by catalogue item, else by name and place. */
const placeIdentity = (p: PlaceSpec): string =>
  p.curated ?? `${p.name}|${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`;

export async function ensurePlace(
  ctx: SeedContext,
  spec: PlaceSpec,
  visited: boolean
): Promise<string> {
  const identity = placeIdentity(spec);
  const known = ctx.placeIds.get(identity);
  if (known) {
    if (visited) await prisma.place.update({ where: { id: known }, data: { visited: true } });
    return known;
  }
  // The catalogue is seeded by the server, possibly after this runs: a place
  // whose item is not there yet stays an ordinary place rather than failing.
  const curatedItemId = spec.curated && ctx.curatedIds.has(spec.curated) ? spec.curated : null;
  const row = await prisma.place.create({
    data: {
      userId: ctx.userId,
      name: spec.name,
      category: spec.category,
      lat: spec.lat,
      lon: spec.lon,
      city: spec.city,
      country: spec.country,
      isoCountryCode: spec.iso,
      visited,
      curatedItemId,
      notes: spec.notes ?? null,
      dataSource: curatedItemId ? "curated" : "manual",
    },
  });
  ctx.placeIds.set(identity, row.id);
  return row.id;
}

export async function writePlaces(
  ctx: SeedContext,
  tripId: string | null,
  day: Date,
  specs: readonly PlaceSpec[]
): Promise<number> {
  let visits = 0;
  for (const [orderIdx, spec] of specs.entries()) {
    const placeId = await ensurePlace(ctx, spec, spec.d !== null);
    if (spec.d === null) continue;
    await prisma.placeVisit.create({
      data: {
        placeId,
        userId: ctx.userId,
        tripId,
        // Midday of the visit's day: the day is what is known, not the hour.
        visitedAt: new Date(addDays(day, spec.d).getTime() + 12 * 3_600_000),
        orderIdx,
        rating: spec.rating ?? null,
        notes: spec.notes ?? null,
      },
    });
    visits++;
  }
  return visits;
}
