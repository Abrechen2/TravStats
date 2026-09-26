import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { authenticate, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { statsLimiter } from "../../middleware/rateLimit";

/**
 * `GET /flights/entry-suggestions` — what the flight forms can offer from the
 * user's own logbook: seats they keep choosing, the flight numbers they have
 * flown on this route or with this airline, the frequent flyer number they
 * last booked this airline with, the terminals they left this airport from,
 * and (forgejo#132) each chip's usage count, their own airlines and aircraft.
 *
 * Its own router file because `routes/flights.ts` sits in the file-size
 * baseline and may not grow by a line; it is mounted BEFORE that router, or
 * its `GET /:id` would read "entry-suggestions" as a flight id.
 *
 * Rate-limited with the stats bucket: unlike the typeahead catalogues
 * (`/suggestions/*`, `/ships/cruise-lines`) this is not a per-keystroke read
 * of a small table but four aggregations over the whole logbook, and the
 * client only asks when the airline or a route end settles.
 */
const router = Router();
router.use(authenticate);

const SEAT_CAP = 5;
const FLIGHT_NUMBER_CAP = 6;
const TERMINAL_CAP = 4;
const AIRLINE_CAP = 6;
const AIRCRAFT_CAP = 5;
/** Rows read per group before the case-insensitive merge; the merge can only
 *  shrink the list, so a small multiple of the cap keeps it full. */
const OVERFETCH = 3;

const blankToUndefined = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const airportCode = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,4}$/, "IATA or ICAO airport code")
    .optional()
);

export const entrySuggestionsQuerySchema = z.object({
  airline: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
  dep: airportCode,
  arr: airportCode,
});

/** A chip and how often the logbook holds it — the "3×" (forgejo#132 item 19). */
export interface RankedValue {
  value: string;
  usageCount: number;
}

export interface RankedAirline {
  /** The most-used spelling of the name; null when only a code was ever recorded. */
  name: string | null;
  iata: string | null;
  icao: string | null;
  usageCount: number;
}

export interface FlightEntrySuggestions {
  seats: string[];
  flightNumbers: string[];
  frequentFlyerNumber: string | null;
  departureTerminals: string[];
  /** The three lists above with their counts, in the same order. */
  usage: {
    seats: RankedValue[];
    flightNumbers: RankedValue[];
    departureTerminals: RankedValue[];
  };
  /** The user's own marketing airlines, most flown first (forgejo#132 item 21). */
  airlines: RankedAirline[];
  /** Aircraft flown with `airline` first, then the rest of the logbook (item 21). */
  aircraft: RankedValue[];
}

type RankedField = "seatNumber" | "flightNumber" | "terminal" | "aircraft";

/** Marketing airline only: a frequent flyer number is credited to the program
 *  of the carrier that sold the ticket, not the one that flew it. */
function airlineWhere(airline: string): Prisma.FlightWhereInput {
  const code = airline.toUpperCase();
  return {
    OR: [
      { airline: { equals: airline, mode: "insensitive" } },
      { airlineIata: code },
      { airlineIcao: code },
    ],
  };
}

function departsFrom(code: string): Prisma.FlightWhereInput {
  return { OR: [{ depIata: code }, { depIcao: code }] };
}

function arrivesAt(code: string): Prisma.FlightWhereInput {
  return { OR: [{ arrIata: code }, { arrIcao: code }] };
}

/** Non-null and non-blank — a cleared input is stored as "" by some paths. */
function present(field: RankedField): Prisma.FlightWhereInput {
  return { AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }] };
}

/** Distinct values of one column, most frequent first, then most recently
 *  flown. Grouped and bounded in the database. */
async function rankedValues(
  field: RankedField,
  where: Prisma.FlightWhereInput,
  cap: number
): Promise<RankedValue[]> {
  // A column-generic groupBy defeats Prisma's result inference, so the row
  // shape is stated once here instead of cast at every read.
  const groups = (await prisma.flight.groupBy({
    by: [field],
    where: { AND: [where, present(field)] },
    _count: { [field]: true },
    _max: { departureTime: true },
    // Undated rows sort first under `desc`; the merge below re-ranks them last.
    orderBy: [{ _count: { [field]: "desc" } }, { _max: { departureTime: "desc" } }],
    take: cap * OVERFETCH,
  })) as unknown as Array<{
    [key: string]: unknown;
    _count: Record<string, number>;
    _max: { departureTime: Date | null };
  }>;

  // "12a" and "12A" are one seat: sum their counts, keep the later flight, and
  // show the spelling the database ranked first.
  const merged = new Map<string, { value: string; count: number; last: number }>();
  for (const g of groups) {
    const value = (g[field] as string | null)?.trim() ?? "";
    if (!value) continue;
    const key = value.toUpperCase();
    const count = g._count[field] ?? 0;
    const last = g._max.departureTime?.getTime() ?? Number.NEGATIVE_INFINITY;
    const seen = merged.get(key);
    merged.set(
      key,
      seen
        ? { value: seen.value, count: seen.count + count, last: Math.max(seen.last, last) }
        : { value, count, last }
    );
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, cap)
    .map((entry) => ({ value: entry.value, usageCount: entry.count }));
}

/**
 * Keeps the first spelling of each value (the best-ranked one), with the count
 * of the list it was ranked in — a route's flight number says how often it was
 * flown on that route, which is why it is offered first.
 */
function dedupe(values: ReadonlyArray<RankedValue>, cap: number): RankedValue[] {
  const seen = new Set<string>();
  const out: RankedValue[] = [];
  for (const ranked of values) {
    const value = ranked.value.trim();
    const key = value.toUpperCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push({ value, usageCount: ranked.usageCount });
    if (out.length === cap) break;
  }
  return out;
}

const valuesOf = (ranked: RankedValue[]): string[] => ranked.map((r) => r.value);

/** The route's own flight numbers first, then the airline's. With neither
 *  known — the lookup step asks before either exists — the overall ranking. */
async function flightNumbersFor(
  userId: string,
  airline: string | undefined,
  dep: string | undefined,
  arr: string | undefined
): Promise<RankedValue[]> {
  const scoped: Prisma.FlightWhereInput[] = [];
  if (dep && arr) scoped.push({ AND: [departsFrom(dep), arrivesAt(arr)] });
  if (airline) scoped.push(airlineWhere(airline));
  if (scoped.length === 0) return rankedValues("flightNumber", { userId }, FLIGHT_NUMBER_CAP);

  const lists = await Promise.all(
    scoped.map((w) => rankedValues("flightNumber", { AND: [{ userId }, w] }, FLIGHT_NUMBER_CAP))
  );
  return dedupe(lists.flat(), FLIGHT_NUMBER_CAP);
}

/** The airline's own aircraft first, then the whole logbook's. */
async function aircraftFor(userId: string, airline: string | undefined): Promise<RankedValue[]> {
  const overall = rankedValues("aircraft", { userId }, AIRCRAFT_CAP);
  if (!airline) return overall;
  const own = rankedValues("aircraft", { AND: [{ userId }, airlineWhere(airline)] }, AIRCRAFT_CAP);
  return dedupe([...(await own), ...(await overall)], AIRCRAFT_CAP);
}

const blankToNull = (v: string | null): string | null => (v && v.trim() ? v.trim() : null);

/**
 * The user's marketing airlines, most flown first, then most recently. One
 * airline is one code: "Lufthansa", "lufthansa" and "LH" are the same row, and
 * the most-used spelling of the name is shown. A flight with no airline at all
 * offers nothing.
 */
async function airlinesFor(userId: string): Promise<RankedAirline[]> {
  const groups = await prisma.flight.groupBy({
    by: ["airline", "airlineIata", "airlineIcao"],
    where: { userId },
    _count: { _all: true },
    _max: { departureTime: true },
  });
  const merged = new Map<
    string,
    {
      names: Map<string, number>;
      iata: string | null;
      icao: string | null;
      count: number;
      last: number;
    }
  >();
  for (const g of groups) {
    const name = blankToNull(g.airline);
    const iata = blankToNull(g.airlineIata)?.toUpperCase() ?? null;
    const icao = blankToNull(g.airlineIcao)?.toUpperCase() ?? null;
    const key = iata ?? icao ?? name?.toLowerCase();
    if (!key) continue;
    const entry = merged.get(key) ?? { names: new Map(), iata, icao, count: 0, last: -Infinity };
    if (name) entry.names.set(name, (entry.names.get(name) ?? 0) + g._count._all);
    merged.set(key, {
      ...entry,
      iata: entry.iata ?? iata,
      icao: entry.icao ?? icao,
      count: entry.count + g._count._all,
      last: Math.max(entry.last, g._max.departureTime?.getTime() ?? -Infinity),
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, AIRLINE_CAP)
    .map((e) => ({
      name: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      iata: e.iata,
      icao: e.icao,
      usageCount: e.count,
    }));
}

async function frequentFlyerNumberFor(userId: string, airline: string): Promise<string | null> {
  const row = await prisma.flight.findFirst({
    where: {
      AND: [
        { userId },
        airlineWhere(airline),
        { frequentFlyerNumber: { not: null } },
        { NOT: { frequentFlyerNumber: "" } },
      ],
    },
    orderBy: [{ departureTime: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { frequentFlyerNumber: true },
  });
  return row?.frequentFlyerNumber?.trim() || null;
}

router.get(
  "/entry-suggestions",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = entrySuggestionsQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const userId = req.userId!;
      const { airline, dep, arr } = parsed.data;

      const [seats, flightNumbers, frequentFlyerNumber, terminals, airlines, aircraft] =
        await Promise.all([
          rankedValues("seatNumber", { userId }, SEAT_CAP),
          flightNumbersFor(userId, airline, dep, arr),
          airline ? frequentFlyerNumberFor(userId, airline) : Promise.resolve(null),
          dep
            ? rankedValues("terminal", { AND: [{ userId }, departsFrom(dep)] }, TERMINAL_CAP)
            : Promise.resolve([]),
          airlinesFor(userId),
          aircraftFor(userId, airline),
        ]);

      const body: FlightEntrySuggestions = {
        seats: valuesOf(seats),
        flightNumbers: valuesOf(flightNumbers),
        frequentFlyerNumber,
        departureTerminals: valuesOf(terminals),
        usage: { seats, flightNumbers, departureTerminals: terminals },
        airlines,
        aircraft,
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
