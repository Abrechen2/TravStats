import { distanceM, type ZoneCircle } from "../../travtrack/classify";
import { daysBetween, fromDbDate, toDbDate } from "../../../shared/time/localDate";
import { routeLegs } from "../routeSchedule";
import type { PlanSnapshot } from "./planSnapshot";
import type { ActualPosition, ActualRoute, ActualStay } from "./actualRoute";

/**
 * Plan versus actual (TravTrack plan L5) — pure. The plan is read, never
 * written (review focus 29): nothing here returns anything a caller could
 * apply to it.
 *
 * Abstention is a result (review focus 27): a station whose days hold no
 * data is `unknown`, never `skipped`; a stage's actual length is `null`
 * unless both ends were visited and the track joins them.
 */

/** A position or stay this close to a station's place counts as being there. */
export const NEAR_M = 15_000;

export type StationStatus = "visited" | "shifted" | "skipped" | "unknown";

export interface StationComparison {
  stationId: string;
  title: string;
  /** The planned days, from the plan's own schedule; null where the plan cannot say. */
  plannedFrom: string | null;
  plannedUntil: string | null;
  status: StationStatus;
  /**
   * `visited`: the first day there minus the planned arrival (−1, 0, +1 within
   * the one-day tolerance). `shifted`: days before the planned arrival
   * (negative) or after the planned departure (positive). Otherwise null.
   */
  deltaDays: number | null;
  /** The first and last day near the station; null unless visited or shifted. */
  actualFrom: string | null;
  actualUntil: string | null;
}

export interface StageComparison {
  stageId: string;
  fromStationId: string;
  toStationId: string;
  plannedKm: number | null;
  actualKm: number | null;
}

export interface UnplannedStay {
  kind: ActualStay["kind"];
  day: string;
  lat: number;
  lon: number;
  label: string;
}

export interface PlanActualComparison {
  stations: StationComparison[];
  stages: StageComparison[];
  unplanned: UnplannedStay[];
}

const DAY_MS = 86_400_000;
const addDays = (day: string, n: number): string =>
  fromDbDate(new Date(toDbDate(day).getTime() + n * DAY_MS));

const near = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  distanceM(a, b) <= NEAR_M;

const insideCircle = (p: { lat: number; lon: number }, circles: readonly ZoneCircle[]) =>
  circles.some((c) => distanceM(p, c) <= c.radiusM);

function daysFrom(from: string, until: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= until; d = addDays(d, 1)) out.push(d);
  return out;
}

const unknownStation = (
  base: Omit<StationComparison, "status" | "deltaDays" | "actualFrom" | "actualUntil">
): StationComparison => ({
  ...base,
  status: "unknown",
  deltaDays: null,
  actualFrom: null,
  actualUntil: null,
});

function compareStation(
  plan: PlanSnapshot,
  index: number,
  actual: ActualRoute | null
): StationComparison {
  const station = plan.stations[index];
  const days = plan.schedule.stations[index];
  const from = days?.arriveDay ?? null;
  const until = days?.departDay ?? from;
  const base = {
    stationId: station.id,
    title: station.title,
    plannedFrom: from,
    plannedUntil: from ? until : null,
  };
  // The missing points inside a privacy circle are the zone, not a skip — and
  // nothing about the station may say otherwise.
  if (!actual || insideCircle(station.place, actual.circles)) return unknownStation(base);

  const nearDays = [
    ...new Set([
      ...actual.positions.filter((p) => near(p, station.place)).map((p) => p.day),
      // A stay inside a privacy circle is the owner's own record and still listed, but it
      // never proves a station outside the zone by itself: only track evidence does there.
      ...actual.stays
        .filter((s) => near(s, station.place) && !insideCircle(s, actual.circles))
        .map((s) => s.day),
    ]),
  ].sort();

  if (!from || !until) {
    // No planned days: being there is all that can be said.
    if (nearDays.length === 0) return unknownStation(base);
    return {
      ...base,
      status: "visited",
      deltaDays: null,
      actualFrom: nearDays[0],
      actualUntil: nearDays[nearDays.length - 1],
    };
  }

  const windowFrom = addDays(from, -1);
  const windowUntil = addDays(until, 1);
  const inWindow = nearDays.filter((d) => d >= windowFrom && d <= windowUntil);
  if (inWindow.length > 0) {
    return {
      ...base,
      status: "visited",
      deltaDays: daysBetween(from, inWindow[0]),
      actualFrom: inWindow[0],
      actualUntil: inWindow[inWindow.length - 1],
    };
  }
  if (nearDays.length > 0) {
    const offset = (d: string) => (d < from ? daysBetween(from, d) : daysBetween(until, d));
    const closest = nearDays.reduce((a, b) => (Math.abs(offset(b)) < Math.abs(offset(a)) ? b : a));
    const run = nearDays.filter((d) => Math.sign(offset(d)) === Math.sign(offset(closest)));
    return {
      ...base,
      status: "shifted",
      deltaDays: offset(closest),
      actualFrom: run[0],
      actualUntil: run[run.length - 1],
    };
  }
  const recorded = new Set(actual.days.filter((d) => d.state === "recorded").map((d) => d.day));
  const allRecorded = daysFrom(from, until).every((d) => recorded.has(d));
  // A short read is said to be short: it never proves an absence.
  if (actual.coverage === "complete" && allRecorded) {
    return { ...base, status: "skipped", deltaDays: null, actualFrom: null, actualUntil: null };
  }
  return unknownStation(base);
}

/** Positions of one device in time order. */
function byDevice(positions: readonly ActualPosition[]): ActualPosition[][] {
  const map = new Map<string | null, ActualPosition[]>();
  for (const p of positions) {
    const list = map.get(p.deviceId) ?? [];
    list.push(p);
    map.set(p.deviceId, list);
  }
  return [...map.values()].map((list) => [...list].sort((a, b) => a.atMs - b.atMs));
}

/**
 * The track's length from the last time near `a` to the first near `b` after
 * it, each end taken at the closest approach, on the device that recorded that stretch most densely. Null when
 * the track never leads from one to the other (a stay-only visit, say).
 */
function trackKm(
  positions: readonly ActualPosition[],
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number | null {
  let best: { count: number; km: number } | null = null;
  for (const list of byDevice(positions)) {
    let lastA = -1;
    let arrival = -1;
    for (let i = 0; i < list.length; i++) {
      if (near(list[i], a)) lastA = i;
      else if (lastA >= 0 && near(list[i], b)) {
        arrival = i;
        break;
      }
    }
    if (lastA < 0 || arrival < 0) continue;
    // Measured from the closest approach to each place, not from where the
    // 15 km circle is crossed: otherwise every stage loses up to 30 km.
    let from = lastA;
    for (let i = lastA; i >= 0 && near(list[i], a); i--) {
      if (distanceM(list[i], a) < distanceM(list[from], a)) from = i;
    }
    let to = arrival;
    for (let i = arrival; i < list.length && near(list[i], b); i++) {
      if (distanceM(list[i], b) < distanceM(list[to], b)) to = i;
    }
    let metres = 0;
    for (let i = from + 1; i <= to; i++) metres += distanceM(list[i - 1], list[i]);
    const count = to - from + 1;
    if (!best || count > best.count) best = { count, km: Math.round(metres / 100) / 10 };
  }
  return best ? best.km : null;
}

export function comparePlanActual(
  plan: PlanSnapshot,
  actual: ActualRoute | null
): PlanActualComparison {
  const stations = plan.stations.map((_, i) => compareStation(plan, i, actual));
  const status = new Map(stations.map((s) => [s.stationId, s.status]));
  const wasThere = (id: string) => status.get(id) === "visited" || status.get(id) === "shifted";

  const stages = routeLegs([...plan.stations], [...plan.stages]).flatMap((stage, i) => {
    if (!stage) return [];
    const from = plan.stations[i];
    const to = plan.stations[i + 1];
    const actualKm =
      actual && wasThere(from.id) && wasThere(to.id)
        ? trackKm(actual.positions, from.place, to.place)
        : null;
    return [
      {
        stageId: stage.id,
        fromStationId: from.id,
        toStationId: to.id,
        plannedKm: stage.distanceKm,
        actualKm,
      },
    ];
  });

  const seen = new Set<string>();
  const unplanned: UnplannedStay[] = [];
  for (const stay of actual?.stays ?? []) {
    if (seen.has(stay.id)) continue;
    seen.add(stay.id);
    if (plan.stations.some((s) => near(stay, s.place))) continue;
    unplanned.push({
      kind: stay.kind,
      day: stay.day,
      lat: stay.lat,
      lon: stay.lon,
      label: stay.label,
    });
  }
  return { stations, stages, unplanned };
}
