import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { authenticate, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { statsLimiter } from "../../middleware/rateLimit";
import { RAIL_TRAVEL_CLASSES } from "../../schemas/rail";

/**
 * `GET /rail/entry-suggestions` — what the rail form can offer from the
 * user's own logbook: the trains they took between the two stations (either
 * direction, because the ride home is the same line), the operators they
 * ride with, the class they usually book, and the coaches and seats they keep
 * choosing. The flight form's `/flights/entry-suggestions`, for trains.
 *
 * Offered, never written: the form shows chips and a chip only fills a field
 * when clicked. A loyalty number is absent on purpose — `RailJourney` has no
 * column for one, and a suggestion must come from a stored value, not from a
 * guess.
 *
 * Enveloped, like the rest of the rail family. Mounted ahead of the rail
 * router, whose `/:id` would otherwise read "entry-suggestions" as an id.
 * Rate-limited with the stats bucket: five aggregations over the logbook, and
 * the client asks only when a station or the operator settles.
 */
const router = Router();
router.use(authenticate);

const TRAIN_CAP = 6;
const OPERATOR_CAP = 5;
const COACH_CAP = 4;
const SEAT_CAP = 5;
/** Rows read per group before the case-insensitive merge (which only shrinks). */
const OVERFETCH = 3;

const blankToUndefined = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const stationName = z.preprocess(blankToUndefined, z.string().trim().max(200).optional());
const stationId = z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional());

export const railEntrySuggestionsQuerySchema = z.object({
  /** The catalogue row, when the station was picked there. */
  depStationId: stationId,
  arrStationId: stationId,
  /** The station's name — the match for a geocoder pick without a row. */
  depName: stationName,
  arrName: stationName,
  operator: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
});

export type RailEntrySuggestionsQuery = z.infer<typeof railEntrySuggestionsQuerySchema>;

export interface RailTrainSuggestion {
  category: string | null;
  number: string;
}

export interface RailEntrySuggestions {
  trains: RailTrainSuggestion[];
  operators: string[];
  travelClass: (typeof RAIL_TRAVEL_CLASSES)[number] | null;
  coaches: string[];
  seats: string[];
}

interface StationRef {
  id?: number;
  name?: string;
}

/** One end of the ride: the catalogue row, or the name when there is no row. */
function stationWhere(end: "dep" | "arr", station: StationRef): Prisma.RailJourneyWhereInput {
  const idField = end === "dep" ? "depStationId" : "arrStationId";
  const nameField = end === "dep" ? "depStationName" : "arrStationName";
  const or: Prisma.RailJourneyWhereInput[] = [];
  if (station.id !== undefined) or.push({ [idField]: station.id });
  if (station.name) or.push({ [nameField]: { equals: station.name, mode: "insensitive" } });
  return { OR: or };
}

const known = (s: StationRef): boolean => s.id !== undefined || Boolean(s.name);

/** The pair in both directions: Munich→Berlin and Berlin→Munich are one line. */
function pairWhere(dep: StationRef, arr: StationRef): Prisma.RailJourneyWhereInput {
  return {
    OR: [
      { AND: [stationWhere("dep", dep), stationWhere("arr", arr)] },
      { AND: [stationWhere("dep", arr), stationWhere("arr", dep)] },
    ],
  };
}

type TextColumn = "operator" | "coach" | "seat" | "travelClass";

function present(field: TextColumn | "trainNumber"): Prisma.RailJourneyWhereInput {
  return { AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }] };
}

interface Ranked {
  value: string;
  count: number;
  last: number;
}

/** Most frequent first, then most recent; "12a" and "12A" are one value. */
function mergeRanked(rows: Array<{ key: string; value: string; count: number; last: number }>) {
  const merged = new Map<string, Ranked>();
  for (const row of rows) {
    const seen = merged.get(row.key);
    merged.set(
      row.key,
      seen
        ? { value: seen.value, count: seen.count + row.count, last: Math.max(seen.last, row.last) }
        : { value: row.value, count: row.count, last: row.last }
    );
  }
  return [...merged.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}

/** Distinct values of one text column, grouped and bounded in the database. */
async function rankedColumn(
  field: TextColumn,
  where: Prisma.RailJourneyWhereInput,
  cap: number
): Promise<string[]> {
  // A column-generic groupBy defeats Prisma's result inference; the row shape
  // is stated once here instead of cast at every read.
  const groups = (await prisma.railJourney.groupBy({
    by: [field],
    where: { AND: [where, present(field)] },
    _count: { [field]: true },
    _max: { departureTime: true },
    orderBy: [{ _count: { [field]: "desc" } }, { _max: { departureTime: "desc" } }],
    take: cap * OVERFETCH,
  })) as unknown as Array<{
    [key: string]: unknown;
    _count: Record<string, number>;
    _max: { departureTime: Date | null };
  }>;
  return mergeRanked(
    groups
      .map((g) => ({
        value: String(g[field] ?? "").trim(),
        count: g._count[field] ?? 0,
        last: g._max.departureTime?.getTime() ?? 0,
      }))
      .filter((g) => g.value !== "")
      .map((g) => ({ ...g, key: g.value.toUpperCase() }))
  )
    .slice(0, cap)
    .map((r) => r.value);
}

/** Trains as category + number, the pair a ticket prints ("ICE 578"). */
async function rankedTrains(
  where: Prisma.RailJourneyWhereInput,
  cap: number
): Promise<RailTrainSuggestion[]> {
  const groups = await prisma.railJourney.groupBy({
    by: ["trainCategory", "trainNumber"],
    where: { AND: [where, present("trainNumber")] },
    _count: { trainNumber: true },
    _max: { departureTime: true },
    orderBy: [{ _count: { trainNumber: "desc" } }, { _max: { departureTime: "desc" } }],
    take: cap * OVERFETCH,
  });
  const byKey = new Map<string, RailTrainSuggestion>();
  const ranked = mergeRanked(
    groups
      .map((g) => {
        const category = g.trainCategory?.trim() || null;
        const number = (g.trainNumber ?? "").trim();
        const key = `${(category ?? "").toUpperCase()} ${number.toUpperCase()}`;
        if (number && !byKey.has(key)) byKey.set(key, { category, number });
        return {
          key,
          value: key,
          count: g._count.trainNumber ?? 0,
          last: g._max.departureTime?.getTime() ?? 0,
        };
      })
      .filter((g) => byKey.has(g.key))
  );
  return ranked.slice(0, cap).map((r) => byKey.get(r.value)!);
}

function dedupeTrains(lists: RailTrainSuggestion[][], cap: number): RailTrainSuggestion[] {
  const seen = new Set<string>();
  const out: RailTrainSuggestion[] = [];
  for (const train of lists.flat()) {
    const key = `${(train.category ?? "").toUpperCase()} ${train.number.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(train);
    if (out.length === cap) break;
  }
  return out;
}

/**
 * The pair's own trains first, then the operator's. With neither known — the
 * form opens empty — the overall ranking, so a commuter's one train is offered
 * before a station is picked.
 */
async function trainsFor(
  userId: string,
  dep: StationRef,
  arr: StationRef,
  operator: string | undefined
): Promise<RailTrainSuggestion[]> {
  const scoped: Prisma.RailJourneyWhereInput[] = [];
  if (known(dep) && known(arr)) scoped.push(pairWhere(dep, arr));
  if (operator) scoped.push({ operator: { equals: operator, mode: "insensitive" } });
  if (scoped.length === 0) return rankedTrains({ userId }, TRAIN_CAP);
  const lists = await Promise.all(
    scoped.map((w) => rankedTrains({ AND: [{ userId }, w] }, TRAIN_CAP))
  );
  return dedupeTrains(lists, TRAIN_CAP);
}

/** The operators that ran the pair first, then the user's overall ones. */
async function operatorsFor(userId: string, dep: StationRef, arr: StationRef): Promise<string[]> {
  const lists = await Promise.all([
    known(dep) && known(arr)
      ? rankedColumn("operator", { AND: [{ userId }, pairWhere(dep, arr)] }, OPERATOR_CAP)
      : Promise.resolve([]),
    rankedColumn("operator", { userId }, OPERATOR_CAP),
  ]);
  const seen = new Set<string>();
  return lists
    .flat()
    .filter((v) => {
      const key = v.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, OPERATOR_CAP);
}

/** The class booked most often; a value outside the vocabulary is not offered. */
async function usualClass(userId: string): Promise<RailEntrySuggestions["travelClass"]> {
  const [top] = await rankedColumn("travelClass", { userId }, 1);
  return RAIL_TRAVEL_CLASSES.find((c) => c === top) ?? null;
}

export async function loadRailEntrySuggestions(
  userId: string,
  query: RailEntrySuggestionsQuery
): Promise<RailEntrySuggestions> {
  const dep: StationRef = { id: query.depStationId, name: query.depName };
  const arr: StationRef = { id: query.arrStationId, name: query.arrName };
  const [trains, operators, travelClass, coaches, seats] = await Promise.all([
    trainsFor(userId, dep, arr, query.operator),
    operatorsFor(userId, dep, arr),
    usualClass(userId),
    rankedColumn("coach", { userId }, COACH_CAP),
    rankedColumn("seat", { userId }, SEAT_CAP),
  ]);
  return { trains, operators, travelClass, coaches, seats };
}

router.get(
  "/",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = railEntrySuggestionsQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const data = await loadRailEntrySuggestions(req.userId!, parsed.data);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
