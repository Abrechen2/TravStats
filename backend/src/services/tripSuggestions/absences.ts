import { haversineKm } from "../../shared/geo/haversine";
import {
  AWAY_KM,
  BRIDGE_DAYS,
  FLIGHT_SIGNAL_MAX_DAYS,
  HOME_LAYOVER_HOURS,
  IMPLIED_NIGHT_KM,
} from "../../shared/tripSuggestionRules";
import { addDays, dayDiff, dayNumber } from "./time";
import type { HomeAt, PresenceEntry, PresencePoint, SuggestionSignal } from "./types";

/**
 * The presence timeline, folded into absences: contiguous stretches the user
 * spent away from home.
 *
 * Every point of every entry is classified against the home that was valid on
 * its day — away, home, or unknown when nothing says where home was — and the
 * away points are walked in time order. An absence grows while the next away
 * point falls within the bridge of what it already covers, and ends when a
 * recorded return home (not a change of planes) or a silence longer than the
 * bridge intervenes.
 */

export interface Absence {
  startDay: string;
  endDay: string;
  /** Entries whose FIRST away point fell in this absence. */
  entries: PresenceEntry[];
  /** Nights away, explicit or implied — see `countNights`. */
  nights: number;
  signals: Set<SuggestionSignal>;
}

type PointClass = "away" | "home" | "unknown";

interface ClassifiedPoint {
  entry: PresenceEntry;
  point: PresencePoint;
  cls: PointClass;
  /** Distance from home, when home was known. */
  km: number | null;
  /** Local hours since the epoch — an ordering key, not an instant. */
  t: number;
  seq: number;
}

function classify(point: PresencePoint, homeAt: HomeAt): { cls: PointClass; km: number | null } {
  const home = homeAt(point.day);
  if (home === null) return { cls: "unknown", km: null };
  const km = haversineKm(home, point);
  return { cls: km > AWAY_KM ? "away" : "home", km };
}

export function classifyPoints(
  entries: readonly PresenceEntry[],
  homeAt: HomeAt
): ClassifiedPoint[] {
  const out: ClassifiedPoint[] = [];
  let seq = 0;
  for (const entry of entries) {
    for (const point of entry.points) {
      out.push({
        entry,
        point,
        ...classify(point, homeAt),
        t: dayNumber(point.day) * 24 + point.hour,
        seq: seq++,
      });
    }
  }
  return out.sort((a, b) => a.t - b.t || a.seq - b.seq);
}

interface Building {
  startDay: string;
  endDay: string;
  coveredUntil: string;
  lastAwayT: number;
  entries: PresenceEntry[];
  awayPoints: ClassifiedPoint[];
}

const maxDay = (a: string, b: string): string => (a > b ? a : b);

/**
 * Nights of `[startDay, endDay)` spent away.
 *
 * A night counts when an entry of the absence spends it away itself (a stay, a
 * cruise, an overnight ride, a roadtrip station), or when the user was more
 * than `IMPLIED_NIGHT_KM` from home on both sides of it with no return home in
 * between — see the constant for why the distance matters.
 */
export function countNights(
  startDay: string,
  endDay: string,
  entries: readonly PresenceEntry[],
  awayPoints: readonly { point: PresencePoint; km: number | null }[]
): number {
  const explicit = new Set(entries.flatMap((e) => e.nights));
  const byDay = new Map<string, number>();
  for (const { point, km } of awayPoints) {
    const far = km ?? 0;
    byDay.set(point.day, Math.max(byDay.get(point.day) ?? 0, far));
  }
  const days = [...byDay.keys()].sort();
  let nights = 0;
  for (let day = startDay; day < endDay; day = addDays(day, 1)) {
    if (explicit.has(day)) {
      nights += 1;
      continue;
    }
    const before = days.filter((d) => d <= day).pop();
    const after = days.find((d) => d > day);
    if (
      before !== undefined &&
      after !== undefined &&
      (byDay.get(before) ?? 0) > IMPLIED_NIGHT_KM &&
      (byDay.get(after) ?? 0) > IMPLIED_NIGHT_KM
    ) {
      nights += 1;
    }
  }
  return nights;
}

/** Fold the classified timeline into absences. */
export function buildAbsences(entries: readonly PresenceEntry[], homeAt: HomeAt): Absence[] {
  const points = classifyPoints(entries, homeAt);
  const done: Building[] = [];
  const claimed = new Set<string>();
  let current: Building | null = null;
  // When the user got home after the last away point — the FIRST home point
  // since, not the latest: the departure that starts the next trip is also at
  // home, and measuring the layover from it would glue two trips together.
  let homeSinceT: number | null = null;

  for (const p of points) {
    if (p.cls === "home") {
      if (homeSinceT === null || (current !== null && homeSinceT < current.lastAwayT)) {
        homeSinceT = p.t;
      }
      continue;
    }
    if (p.cls !== "away") continue;

    const returnedHome =
      current !== null &&
      homeSinceT !== null &&
      homeSinceT >= current.lastAwayT &&
      p.t - homeSinceT > HOME_LAYOVER_HOURS;
    const bridged =
      current !== null && dayDiff(current.coveredUntil, p.point.day) <= BRIDGE_DAYS + 1;

    if (current === null || returnedHome || !bridged) {
      if (current !== null) done.push(current);
      current = {
        startDay: p.point.day,
        endDay: p.point.day,
        coveredUntil: p.point.day,
        lastAwayT: p.t,
        entries: [],
        awayPoints: [],
      };
    }
    current.endDay = maxDay(current.endDay, p.point.day);
    current.coveredUntil = maxDay(current.coveredUntil, maxDay(p.point.day, p.entry.endDay));
    current.lastAwayT = Math.max(current.lastAwayT, p.t);
    current.awayPoints.push(p);
    if (!claimed.has(p.entry.key)) {
      claimed.add(p.entry.key);
      current.entries.push(p.entry);
    }
  }
  if (current !== null) done.push(current);

  return done
    .filter((b) => b.entries.length > 0)
    .map((b) => ({
      startDay: b.startDay,
      endDay: b.endDay,
      entries: b.entries,
      nights: countNights(b.startDay, b.endDay, b.entries, b.awayPoints),
      signals: new Set<SuggestionSignal>(),
    }));
}

type Cluster = { source: SuggestionSignal; flightKeys: readonly string[] };

/** Whether a flight cluster spans few enough days to be one journey (`FLIGHT_SIGNAL_MAX_DAYS`). */
function journeyLike(cluster: Cluster, byKey: ReadonlyMap<string, PresenceEntry>): boolean {
  const flights = cluster.flightKeys
    .map((key) => byKey.get(key))
    .filter((e): e is PresenceEntry => e !== undefined);
  if (flights.length === 0) return false;
  const start = flights.map((f) => f.startDay).reduce((a, b) => (a < b ? a : b));
  const end = flights.map((f) => f.endDay).reduce(maxDay);
  return dayDiff(start, end) <= FLIGHT_SIGNAL_MAX_DAYS;
}

/**
 * Absences when no home is known at all: the flight heuristics' journeys, with
 * every other entry inside a journey's days that lies within reach of one of
 * its destinations. Without a home nothing can be called "away", so this is the
 * only statement the engine can make — and it makes it only where the flights
 * themselves say a journey happened.
 */
export function absencesFromClusters(
  entries: readonly PresenceEntry[],
  clusters: readonly { source: SuggestionSignal; flightKeys: readonly string[] }[],
  plausibleKm: number
): Absence[] {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const claimed = new Set<string>();
  const out: Absence[] = [];
  for (const cluster of clusters) {
    if (!journeyLike(cluster, byKey)) continue;
    const flights = cluster.flightKeys
      .map((key) => byKey.get(key))
      .filter((e): e is PresenceEntry => e !== undefined && !claimed.has(e.key));
    if (flights.length === 0) continue;
    const startDay = flights.map((f) => f.startDay).reduce((a, b) => (a < b ? a : b));
    const endDay = flights.map((f) => f.endDay).reduce(maxDay);
    // Every point but the journey's first departure: that one is where it began.
    const reach = flights.flatMap((f) => f.points).slice(1);
    const others = entries.filter(
      (e) =>
        e.domain !== "flight" &&
        !claimed.has(e.key) &&
        e.startDay <= endDay &&
        e.endDay >= startDay &&
        e.points.some((p) => reach.some((r) => haversineKm(r, p) <= plausibleKm))
    );
    const members = [...flights, ...others];
    members.forEach((m) => claimed.add(m.key));
    const explicit = new Set(members.flatMap((m) => m.nights)).size;
    out.push({
      startDay,
      endDay,
      entries: members,
      nights: Math.max(explicit, dayDiff(startDay, endDay)),
      signals: new Set([cluster.source]),
    });
  }
  return out;
}

/**
 * Glue absences the flight heuristics say are one journey.
 *
 * `tripDetectionService` groups trip-less flights by shared booking reference
 * (≤ 30 days), by a loop out of and back to home, and by an unbroken chain of
 * connecting legs. Each group it finds is a statement that those flights are
 * one journey, so every absence between the first and the last of them is
 * merged — this is what keeps a hub flyer's two halves together when the
 * change of planes at home took longer than the layover window.
 */
export function glueByFlightClusters(
  absences: readonly Absence[],
  clusters: readonly { source: SuggestionSignal; flightKeys: readonly string[] }[],
  homeAt: HomeAt
): Absence[] {
  let result = [...absences];
  const byKey = new Map(absences.flatMap((a) => a.entries.map((e) => [e.key, e] as const)));
  for (const cluster of clusters) {
    if (!journeyLike(cluster, byKey)) continue;
    const wanted = new Set(cluster.flightKeys);
    const hits = result
      .map((a, i) => (a.entries.some((e) => wanted.has(e.key)) ? i : -1))
      .filter((i) => i >= 0);
    if (hits.length === 0) continue;
    const first = hits[0];
    const last = hits[hits.length - 1];
    const merged = result.slice(first, last + 1);
    const entries = merged.flatMap((a) => a.entries);
    const startDay = merged[0].startDay;
    const endDay = merged.map((a) => a.endDay).reduce(maxDay);
    const awayPoints = classifyPoints(entries, homeAt).filter((p) => p.cls === "away");
    const signals = new Set<SuggestionSignal>(merged.flatMap((a) => [...a.signals]));
    signals.add(cluster.source);
    const glued: Absence = {
      startDay,
      endDay,
      entries,
      nights: countNights(startDay, endDay, entries, awayPoints),
      signals,
    };
    result = [...result.slice(0, first), glued, ...result.slice(last + 1)];
  }
  return result;
}
