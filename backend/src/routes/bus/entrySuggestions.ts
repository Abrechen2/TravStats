import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { authenticate, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { statsLimiter } from "../../middleware/rateLimit";

/**
 * `GET /bus/entry-suggestions` — what the bus form can offer from the user's
 * own logbook: the operators they ride with, the fare classes they have used
 * with the one typed, and the terminals that start with what they typed. There
 * is no worldwide catalogue of coach terminals (spec §3.2), so the second ride
 * out of Seoul is the first time the form knows Seoul's position, country and
 * address — without this, every terminal is typed twice.
 *
 * Offered, never written: the form shows chips and a chip fills a field only
 * when clicked, so everything returned is a value some earlier row stored. A
 * fare class is the operator's own vocabulary ("Udeung"), which is why it is
 * suggested per operator and not from a fixed list.
 *
 * Enveloped, like the rest of the bus family. Mounted ahead of the bus router,
 * whose `/:id` would otherwise read "entry-suggestions" as an id. Rate-limited
 * with the stats bucket: three aggregations over the logbook, asked for when a
 * terminal or the operator settles, not per keystroke.
 */
const router = Router();
router.use(authenticate);

const OPERATOR_CAP = 5;
const FARE_CLASS_CAP = 4;
const TERMINAL_CAP = 5;
/** Rows read per terminal end; a terminal ridden often fills the page with itself. */
const TERMINAL_ROWS = 25;
/** Rows read per group before the case-insensitive merge (which only shrinks). */
const OVERFETCH = 3;

const blankToUndefined = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const typed = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const busEntrySuggestionsQuerySchema = z.object({
  /** What has been typed into the departure / arrival terminal field. */
  depName: typed(200),
  arrName: typed(200),
  /** The operator field, which narrows the fare classes offered. */
  operator: typed(100),
});

export type BusEntrySuggestionsQuery = z.infer<typeof busEntrySuggestionsQuerySchema>;

export interface BusTerminalSuggestion {
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  country: string | null;
}

export interface BusEntrySuggestions {
  operators: string[];
  fareClasses: string[];
  terminals: BusTerminalSuggestion[];
}

type TextColumn = "operator" | "fareClass";

function present(field: TextColumn): Prisma.BusJourneyWhereInput {
  return { AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }] };
}

interface Ranked {
  value: string;
  count: number;
}

const byCountThenName = (a: Ranked, b: Ranked): number =>
  b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);

/**
 * Most frequent first, then by name in code-point order — a total order that
 * does not depend on the database's collation, so the list does not reshuffle
 * between two requests. "Kobus" and "kobus" are one operator, spelled as the
 * larger group has it (and, level, as the one that sorts first).
 */
function mergeRanked(rows: Ranked[]): Ranked[] {
  const merged = new Map<string, Ranked>();
  for (const row of [...rows].sort(byCountThenName)) {
    const key = row.value.toLowerCase();
    const seen = merged.get(key);
    merged.set(
      key,
      seen
        ? { value: seen.value, count: seen.count + row.count }
        : { value: row.value, count: row.count }
    );
  }
  return [...merged.values()].sort(byCountThenName);
}

/** Distinct values of one text column, grouped and bounded in the database. */
async function rankedColumn(
  field: TextColumn,
  where: Prisma.BusJourneyWhereInput,
  cap: number
): Promise<string[]> {
  // A column-generic groupBy defeats Prisma's result inference; the row shape
  // is stated once here instead of cast at every read.
  const groups = (await prisma.busJourney.groupBy({
    by: [field],
    where: { AND: [where, present(field)] },
    _count: { [field]: true },
    // The name breaks count ties so the take below cuts at a stable place.
    orderBy: [{ _count: { [field]: "desc" } }, { [field]: "asc" }],
    take: cap * OVERFETCH,
  })) as unknown as Array<{ [key: string]: unknown; _count: Record<string, number> }>;
  return mergeRanked(
    groups
      .map((g) => ({ value: String(g[field] ?? "").trim(), count: g._count[field] ?? 0 }))
      .filter((g) => g.value !== "")
  )
    .slice(0, cap)
    .map((r) => r.value);
}

/** The class is the operator's vocabulary, so it is offered for the operator typed. */
function fareClassesFor(userId: string, operator: string | undefined): Promise<string[]> {
  const where: Prisma.BusJourneyWhereInput = operator
    ? { userId, operator: { equals: operator, mode: "insensitive" } }
    : { userId };
  return rankedColumn("fareClass", where, FARE_CLASS_CAP);
}

interface TerminalRow {
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  country: string | null;
  at: Date;
}

/**
 * A typed name is text, not a pattern. Prisma passes `startsWith` into a LIKE
 * unescaped, so a `%` would match every terminal and an `_` any character.
 */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, "\\$&");

/**
 * One end's rides whose terminal name starts with `prefix` (any, when none was
 * typed), newest first.
 */
async function terminalRows(
  userId: string,
  end: "dep" | "arr",
  prefix: string | undefined
): Promise<TerminalRow[]> {
  const nameField = end === "dep" ? "depStationName" : "arrStationName";
  const select =
    end === "dep"
      ? {
          depStationName: true,
          depAddress: true,
          depLat: true,
          depLon: true,
          depCountry: true,
          departureTime: true,
        }
      : {
          arrStationName: true,
          arrAddress: true,
          arrLat: true,
          arrLon: true,
          arrCountry: true,
          departureTime: true,
        };
  const rows = await prisma.busJourney.findMany({
    where: {
      userId,
      ...(prefix ? { [nameField]: { startsWith: escapeLike(prefix), mode: "insensitive" } } : {}),
    },
    select,
    orderBy: { departureTime: "desc" },
    take: TERMINAL_ROWS,
  });
  return rows.map((r) => {
    const row = r as Record<string, string | number | Date | null>;
    return {
      name: String(row[nameField]).trim(),
      address: (row[end === "dep" ? "depAddress" : "arrAddress"] as string | null) ?? null,
      lat: row[end === "dep" ? "depLat" : "arrLat"] as number,
      lon: row[end === "dep" ? "depLon" : "arrLon"] as number,
      country: (row[end === "dep" ? "depCountry" : "arrCountry"] as string | null) ?? null,
      at: row.departureTime as Date,
    };
  });
}

/**
 * Terminals from both ends of every ride, whichever field is being typed in:
 * the place a ride ended at is the place the ride home starts from, so the
 * departure field must find arrivals too. Both typed names search both ends;
 * with neither typed, both ends are offered unfiltered, newest first. One chip
 * per name, positioned from the newest ride — and a missing address or country
 * is filled from an older ride of the same name rather than offered as unknown
 * when the logbook does know it.
 */
async function terminalsFor(
  userId: string,
  query: BusEntrySuggestionsQuery
): Promise<BusTerminalSuggestion[]> {
  const prefixes = [query.depName, query.arrName].filter((p): p is string => Boolean(p));
  const searches = prefixes.length > 0 ? prefixes : [undefined];
  const reads = searches.flatMap((prefix) => [
    terminalRows(userId, "dep", prefix),
    terminalRows(userId, "arr", prefix),
  ]);
  const rows = (await Promise.all(reads)).flat();
  // Stable: on a shared instant the departure end, read first, keeps its place.
  rows.sort((a, b) => b.at.getTime() - a.at.getTime());

  const byName = new Map<string, BusTerminalSuggestion>();
  for (const row of rows) {
    if (row.name === "") continue;
    const key = row.name.toLowerCase();
    const seen = byName.get(key);
    if (!seen) {
      if (byName.size < TERMINAL_CAP) {
        byName.set(key, {
          name: row.name,
          address: row.address,
          lat: row.lat,
          lon: row.lon,
          country: row.country,
        });
      }
      continue;
    }
    byName.set(key, {
      ...seen,
      address: seen.address ?? row.address,
      country: seen.country ?? row.country,
    });
  }
  return [...byName.values()];
}

export async function loadBusEntrySuggestions(
  userId: string,
  query: BusEntrySuggestionsQuery
): Promise<BusEntrySuggestions> {
  const [operators, fareClasses, terminals] = await Promise.all([
    rankedColumn("operator", { userId }, OPERATOR_CAP),
    fareClassesFor(userId, query.operator),
    terminalsFor(userId, query),
  ]);
  return { operators, fareClasses, terminals };
}

router.get(
  "/",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = busEntrySuggestionsQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const data = await loadBusEntrySuggestions(req.userId!, parsed.data);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
