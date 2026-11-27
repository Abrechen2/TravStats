import type { ShareEntity } from "./adapters";
import type { FactRecord } from "./factValues";

/**
 * How a link settles the facts two copies disagree in (UAT 2026-11-27). The dry run named only
 * whole-trip decisions, and "Meine übernehmen" pushed the father's STRAIGHT ferry lines over the
 * owner's drawn ones. The rule since then: a decision never lets an empty, straight, unrouted or
 * less precise value overwrite a filled, routed, drawn or more precise one — in either direction.
 *
 * Facts are judged in groups: a line is its geometry with its source and scope (and the distance
 * derived from it); a time is its instant with its precision. Each group has a quality:
 *
 * - line: drawn or tracked (3) > routed (2) > straight (1) > none (0), then the number of points;
 * - time: a time of day (3) > a day (2) > month or year (1) > nothing (0);
 * - anything else: filled (1) > empty (0).
 *
 * The trip-level decision is the default for each group; the better side wins wherever the two
 * differ in quality, and only a tie follows the decision. A per-field choice the person made in
 * the dry run is taken as given. Derived values (distance, CO₂, router version) are never offered
 * as a choice: they ride with their line, or are left to the server to compute again. Nothing here
 * reads the database.
 */

export type FieldChoice = "mine" | "theirs" | "both";
/** The trip-level decision; `best` is the bulk link's: better side wins, a tie keeps both. */
export type SettleDecision = FieldChoice | "best";

/** A pair's per-group choices, keyed by group id. */
export type GroupChoices = Record<string, FieldChoice>;

type GroupKind = "line" | "time" | "plain";

export interface FactGroup {
  id: string;
  kind: GroupKind;
  /** The facts decided together; the first is the one that names the group. */
  fields: readonly string[];
  /** Derived facts that follow the group's choice but are never shown as a difference. */
  derived?: readonly string[];
}

const ROUTE_LINE = (derived: string[] = ["distanceKm", "distanceSource"]): FactGroup => ({
  id: "geometry",
  kind: "line",
  fields: ["geometry", "geometrySource", "manualScope"],
  derived,
});

const timeGroup = (id: string, fields: string[]): FactGroup => ({ id, kind: "time", fields });

const TRANSIT_TIMES = [
  timeGroup("departureTime", ["departureTime", "depPrecision"]),
  timeGroup("arrivalTime", ["arrivalTime", "arrPrecision"]),
];

/** The groups that are more than one fact or more than "filled beats empty", by type. */
const GROUPS: Record<ShareEntity, readonly FactGroup[]> = {
  flight: [
    timeGroup("departureTime", ["departureTime", "depPrecision", "depTimeSemantics"]),
    timeGroup("arrivalTime", ["arrivalTime", "arrPrecision", "arrTimeSemantics"]),
    {
      id: "actualRoute",
      kind: "line",
      fields: ["actualRoute", "routeSource"],
      derived: ["routeDistance", "overflownCountries"],
    },
  ],
  rail: [...TRANSIT_TIMES, ROUTE_LINE()],
  bus: [...TRANSIT_TIMES, ROUTE_LINE()],
  ferry: [...TRANSIT_TIMES, ROUTE_LINE()],
  rental: [
    timeGroup("pickupTime", ["pickupTime", "pickupPrecision"]),
    timeGroup("returnTime", ["returnTime", "returnPrecision"]),
    timeGroup("actualPickupTime", ["actualPickupTime", "actualPickupPrecision"]),
    timeGroup("actualReturnTime", ["actualReturnTime", "actualReturnPrecision"]),
  ],
  lodgingStay: [
    timeGroup("checkIn", ["checkInAt", "checkInDate", "checkInTime", "checkIn"]),
    timeGroup("checkOut", ["checkOutAt", "checkOutDate", "checkOutTime", "checkOut"]),
  ],
  cruise: [{ id: "legRoutes", kind: "line", fields: ["legRoutes"] }],
  roadtrip: [{ id: "routeLegs", kind: "line", fields: ["routeLegs"] }],
  tour: [
    { id: "routeLegs", kind: "line", fields: ["routeLegs"] },
    { id: "tracks", kind: "line", fields: ["tracks"] },
  ],
  stop: [
    timeGroup("startUtc", ["startUtc", "startDate", "precision"]),
    timeGroup("endUtc", ["endUtc", "endDate"]),
  ],
};

/**
 * Derived with no line to follow: the server computes them again from the facts the link writes
 * (a rental's driven distance from its odometer, a stay's nights from its days, a cruise's
 * distance from its legs).
 */
const RECOMPUTED: Partial<Record<ShareEntity, readonly string[]>> = {
  rental: ["distanceKm", "distanceSource"],
  lodgingStay: ["nights"],
  flight: ["delayMinutes"],
};

/** The group a fact belongs to: one of the type's groups, else a group of its own. */
export function groupOf(entity: ShareEntity, field: string): FactGroup {
  for (const g of GROUPS[entity])
    if (g.fields.includes(field) || g.derived?.includes(field)) return g;
  return { id: field, kind: "plain", fields: [field] };
}

/** Facts that are derived and never offered as a choice. */
export function isDerived(entity: ShareEntity, field: string): boolean {
  if (RECOMPUTED[entity]?.includes(field)) return true;
  return GROUPS[entity].some((g) => g.derived?.includes(field));
}

const isEmpty = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !(v instanceof Date) && Object.keys(v as object).length === 0);

/** Sources of a line someone drew or recorded, and of a line nobody routed. */
const DRAWN = new Set(["manual", "drawn", "track", "gpx", "live_tracking"]);
const STRAIGHT = new Set(["straight", "chord", "none", "estimated"]);

/** The points of a stored line: a coordinate array, a GeoJSON geometry, or a feature. */
export function pointsOf(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object") {
    const o = v as { coordinates?: unknown; geometry?: unknown; waypoints?: unknown };
    if (Array.isArray(o.coordinates)) return o.coordinates.length;
    if (o.geometry) return pointsOf(o.geometry);
    if (o.waypoints) return pointsOf(o.waypoints);
  }
  return 0;
}

export type LineQuality = "drawn" | "routed" | "straight" | "none";
const LINE_RANK: Record<LineQuality, number> = { drawn: 3, routed: 2, straight: 1, none: 0 };

function sourceQuality(line: unknown, source: unknown): LineQuality {
  if (isEmpty(line)) return "none";
  const s = typeof source === "string" ? source.toLowerCase() : "";
  if (DRAWN.has(s)) return "drawn";
  if (STRAIGHT.has(s) || pointsOf(line) <= 2) return "straight";
  return "routed";
}

/** A list of lines (cruise legs, roadtrip legs, tour tracks): its best entry and its points. */
function listQuality(list: unknown): { quality: LineQuality; points: number; lines: number } {
  if (!Array.isArray(list) || list.length === 0) return { quality: "none", points: 0, lines: 0 };
  let best: LineQuality = "none";
  let points = 0;
  for (const item of list) {
    const o = (item ?? {}) as Record<string, unknown>;
    const line = o.waypoints ?? o.geometry ?? o.points ?? item;
    const n = pointsOf(line);
    points += n;
    const q =
      typeof o.source === "string"
        ? sourceQuality(line, o.source)
        : n > 2
          ? "routed"
          : n > 0
            ? "straight"
            : "none";
    if (LINE_RANK[q] > LINE_RANK[best]) best = q;
  }
  return { quality: best, points, lines: list.length };
}

/** What a line is, as the dry run shows it. */
export interface LineView {
  quality: LineQuality;
  points: number;
  /** For a list of lines (legs, tracks): how many. */
  lines?: number;
}

export function lineView(group: FactGroup, facts: FactRecord): LineView {
  const first = group.fields[0] as string;
  if (first === "geometry" || first === "actualRoute") {
    const line = facts[first];
    return {
      quality: sourceQuality(line, facts[group.fields[1] as string]),
      points: pointsOf(line),
    };
  }
  return listQuality(facts[first]);
}

const TIME_OF_DAY = new Set(["minute", "second", "hour", "exact", "time"]);
const DAY_ONLY = new Set(["day", "date"]);

function timeRank(group: FactGroup, facts: FactRecord): number {
  if (group.id === "checkIn" || group.id === "checkOut") {
    const [at, date, time] = group.fields.map((f) => facts[f]);
    if (!isEmpty(at) || !isEmpty(time)) return 3;
    return isEmpty(date) ? 0 : 2;
  }
  const value = facts[group.fields[0] as string];
  if (isEmpty(value)) return 0;
  const precision = facts[group.fields[1] as string];
  if (typeof precision !== "string" || precision === "") return 3;
  const p = precision.toLowerCase();
  if (TIME_OF_DAY.has(p)) return 3;
  if (DAY_ONLY.has(p)) return 2;
  return 1;
}

/** A group's quality on one side, comparable: higher is better. */
export function qualityOf(group: FactGroup, facts: FactRecord): number {
  if (group.kind === "line") {
    const v = lineView(group, facts);
    return LINE_RANK[v.quality] * 1_000_000 + Math.min(v.points, 999_999);
  }
  if (group.kind === "time") return timeRank(group, facts);
  return group.fields.some((f) => !isEmpty(facts[f])) ? 1 : 0;
}

/** Which side holds the better value of a group, or null when they are equal in quality. */
export function betterSide(
  group: FactGroup,
  here: FactRecord,
  there: FactRecord
): "here" | "there" | null {
  const a = qualityOf(group, here);
  const b = qualityOf(group, there);
  return a > b ? "here" : b > a ? "there" : null;
}

/** The choice a trip-level decision makes for one group. */
export function defaultChoice(
  decision: SettleDecision,
  better: "here" | "there" | null
): FieldChoice {
  if (better === "here") return decision === "both" ? "both" : "mine";
  if (better === "there") return decision === "both" ? "both" : "theirs";
  return decision === "best" ? "both" : decision;
}

/**
 * Whether a difference needs the person: both sides hold a value of the same quality and the
 * values differ. An empty side, a better line or a more precise time is settled by the rule.
 */
export const isRealConflict = (group: FactGroup, here: FactRecord, there: FactRecord): boolean =>
  betterSide(group, here, there) === null && qualityOf(group, here) > 0;

/** One differing group of a pair, as the settle step and the dry run read it. */
export interface PairGroup {
  group: FactGroup;
  /** The differing facts of the group (derived ones included). */
  facts: string[];
  better: "here" | "there" | null;
  real: boolean;
}

/**
 * The differing facts of a pair, grouped; facts the other side did not send at all (a field the
 * transfer cannot carry) and derived facts without a line are returned apart.
 */
export function groupConflicts(
  entity: ShareEntity,
  conflicts: readonly string[],
  here: FactRecord,
  there: FactRecord
): { groups: PairGroup[]; recomputed: string[]; uncarried: string[] } {
  const byId = new Map<string, PairGroup>();
  const recomputed: string[] = [];
  const uncarried: string[] = [];
  for (const field of conflicts) {
    if (!(field in there)) {
      uncarried.push(field);
      continue;
    }
    if (RECOMPUTED[entity]?.includes(field)) {
      recomputed.push(field);
      continue;
    }
    const group = groupOf(entity, field);
    const entry = byId.get(group.id);
    if (entry) entry.facts.push(field);
    else
      byId.set(group.id, {
        group,
        facts: [field],
        better: betterSide(group, here, there),
        real: isRealConflict(group, here, there),
      });
  }
  // A group whose only difference is derived (a distance) is not a choice either.
  const groups: PairGroup[] = [];
  for (const g of byId.values()) {
    if (g.facts.every((f) => g.group.derived?.includes(f))) recomputed.push(...g.facts);
    else groups.push(g);
  }
  return { groups, recomputed, uncarried };
}

/** Which facts of a pair go which way, after the choices. */
export interface SettlePlan {
  /** The caller's values reach the other copy. */
  mine: string[];
  /** The other copy's values are written onto the caller's entry. */
  theirs: string[];
}

/**
 * The facts each way for one pair: an explicit choice for a group wins, otherwise the trip-level
 * decision through the quality rule. Recomputed and uncarried facts go nowhere.
 */
export function settlePlan(
  entity: ShareEntity,
  conflicts: readonly string[],
  here: FactRecord,
  there: FactRecord,
  decision: SettleDecision,
  choices: GroupChoices = {}
): SettlePlan {
  const out: SettlePlan = { mine: [], theirs: [] };
  for (const g of groupConflicts(entity, conflicts, here, there).groups) {
    const choice = choices[g.group.id] ?? defaultChoice(decision, g.better);
    if (choice === "mine") out.mine.push(...g.facts);
    else if (choice === "theirs") out.theirs.push(...g.facts);
  }
  return out;
}

/** Whether a pair can be linked without the person: no difference needs them. */
export function pairIsAutomatic(
  entity: ShareEntity,
  conflicts: readonly string[],
  here: FactRecord,
  there: FactRecord
): boolean {
  return groupConflicts(entity, conflicts, here, there).groups.every((g) => !g.real);
}
