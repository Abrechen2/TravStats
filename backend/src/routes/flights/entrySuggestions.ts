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
 * last booked this airline with, and the terminals they left this airport
 * from.
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

export interface FlightEntrySuggestions {
  seats: string[];
  flightNumbers: string[];
  frequentFlyerNumber: string | null;
  departureTerminals: string[];
}

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
function present(field: "seatNumber" | "flightNumber" | "terminal"): Prisma.FlightWhereInput {
  return { AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }] };
}

/** Distinct values of one column, most frequent first, then most recently
 *  flown. Grouped and bounded in the database. */
async function rankedValues(
  field: "seatNumber" | "flightNumber" | "terminal",
  where: Prisma.FlightWhereInput,
  cap: number
): Promise<string[]> {
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
    .map((entry) => entry.value);
}

/** Keeps the first spelling of each value (the best-ranked one). */
function dedupe(values: ReadonlyArray<string | null | undefined>, cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw?.trim() ?? "";
    const key = value.toUpperCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length === cap) break;
  }
  return out;
}

/** The route's own flight numbers first, then the airline's. With neither
 *  known — the lookup step asks before either exists — the overall ranking. */
async function flightNumbersFor(
  userId: string,
  airline: string | undefined,
  dep: string | undefined,
  arr: string | undefined
): Promise<string[]> {
  const scoped: Prisma.FlightWhereInput[] = [];
  if (dep && arr) scoped.push({ AND: [departsFrom(dep), arrivesAt(arr)] });
  if (airline) scoped.push(airlineWhere(airline));
  if (scoped.length === 0) return rankedValues("flightNumber", { userId }, FLIGHT_NUMBER_CAP);

  const lists = await Promise.all(
    scoped.map((w) => rankedValues("flightNumber", { AND: [{ userId }, w] }, FLIGHT_NUMBER_CAP))
  );
  return dedupe(lists.flat(), FLIGHT_NUMBER_CAP);
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

      const [seats, flightNumbers, frequentFlyerNumber, departureTerminals] = await Promise.all([
        rankedValues("seatNumber", { userId }, SEAT_CAP),
        flightNumbersFor(userId, airline, dep, arr),
        airline ? frequentFlyerNumberFor(userId, airline) : Promise.resolve(null),
        dep
          ? rankedValues("terminal", { AND: [{ userId }, departsFrom(dep)] }, TERMINAL_CAP)
          : Promise.resolve([]),
      ]);

      const body: FlightEntrySuggestions = {
        seats,
        flightNumbers,
        frequentFlyerNumber,
        departureTerminals,
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
