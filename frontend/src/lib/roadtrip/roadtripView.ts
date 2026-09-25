/**
 * What the roadtrip pages derive from the rows they load — phase, days,
 * the station a reader is at, the list's route sketch, the editor's hints.
 * Nothing here is stored or sent; every function is pure so the pages stay
 * layout and the rules stay testable.
 *
 * Dates are compared as calendar days (`YYYY-MM-DD`). Station dates are
 * stored as UTC midnights of the day the user typed, so their first ten
 * characters ARE that day; "today" is the reader's local day.
 */
import {
  ROADTRIP_VEHICLES,
  type RoadtripVehicle,
  type StoredRoadtripVehicle,
} from "../../shared/tour/roadtrip";
import type { RoadtripStation, StationInput, StationNightInput } from "../../types/roadtrip";

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of an ISO timestamp as stored, or null. */
export function dayKey(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** The reader's local calendar day. */
export function localToday(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

export type RoadtripPhase = "undated" | "planned" | "underway" | "past";

/**
 * Where a roadtrip stands against today. A span that has not begun is
 * planned — it counts for nothing in any statistic — and one whose last day
 * is today is still underway: the reader is on the road until it is over.
 */
export function roadtripPhase(
  startDate: string | null,
  endDate: string | null,
  today: string
): RoadtripPhase {
  const start = dayKey(startDate);
  if (!start) return "undated";
  if (start > today) return "planned";
  const end = dayKey(endDate) ?? start;
  return end >= today ? "underway" : "past";
}

/** Day N of the trip (1-based), or null without a start. */
export function dayNumber(startDate: string | null, day: string): number | null {
  const start = dayKey(startDate);
  return start ? daysBetween(start, day) + 1 : null;
}

/** Days from first to last inclusive, or null when either end is missing. */
export function spanDays(startDate: string | null, endDate: string | null): number | null {
  const a = dayKey(startDate);
  const b = dayKey(endDate);
  return a && b ? daysBetween(a, b) + 1 : null;
}

/** The day a station was reached: its own date, else its stay's check-in. */
export function arrivalDay(s: RoadtripStation): string | null {
  return dayKey(s.startDate) ?? dayKey(s.stay?.checkIn);
}

/** The day a station was left: its own end, else its stay's check-out. */
export function departureDay(s: RoadtripStation): string | null {
  return dayKey(s.endDate) ?? dayKey(s.stay?.checkOut);
}

/** A cancelled stay is a night that did not happen (shared/tour/roadtrip.ts). */
export function isStayCancelled(s: Pick<RoadtripStation, "stay">): boolean {
  return s.stay?.status === "cancelled";
}

export interface StationRow {
  station: RoadtripStation;
  /** Set on the first station of a new arrival day; the timeline's day head. */
  day: { key: string; number: number | null } | null;
  isToday: boolean;
  isPlanned: boolean;
}

/**
 * The timeline's rows: a day head wherever the arrival day changes, "today"
 * on the station the reader is at, "planned" on those not yet reached. An
 * undated station neither opens a day nor closes one.
 */
export function stationRows(
  stations: readonly RoadtripStation[],
  startDate: string | null,
  today: string
): StationRow[] {
  const current = currentStationIndex(stations, today);
  let lastDay: string | null = null;
  return stations.map((station, index) => {
    const arrival = arrivalDay(station);
    const opensDay = arrival !== null && arrival !== lastDay;
    if (arrival !== null) lastDay = arrival;
    return {
      station,
      day: opensDay ? { key: arrival, number: dayNumber(startDate, arrival) } : null,
      isToday: index === current,
      isPlanned: arrival !== null && arrival > today,
    };
  });
}

/**
 * The station the reader is at today: the last one reached on or before
 * today, and only while the roadtrip is still running — a station of a
 * finished trip is not where anyone is. -1 when there is none.
 */
export function currentStationIndex(stations: readonly RoadtripStation[], today: string): number {
  let found = -1;
  stations.forEach((s, i) => {
    const arrival = arrivalDay(s);
    if (arrival !== null && arrival <= today) found = i;
  });
  if (found === -1) return -1;
  const departure = departureDay(stations[found]) ?? arrivalDay(stations[found]);
  const isLast = found === stations.length - 1;
  // The last station of a trip is only "today" while it lasts.
  if (isLast && departure !== null && departure < today) return -1;
  return found;
}

/** The first station not yet reached, or null. */
export function nextStation(
  stations: readonly RoadtripStation[],
  today: string
): RoadtripStation | null {
  return stations.find((s) => (arrivalDay(s) ?? "") > today) ?? null;
}

/**
 * The list's route sketch: station points fitted into a w×h box, as an SVG
 * path. Longitude is shrunk by cos(latitude) so Norway does not come out as
 * wide as it is tall. Null when fewer than two points exist — one dot is not
 * a route, and an empty sketch reads as "no route" honestly.
 */
export function sketchPath(
  points: ReadonlyArray<readonly [number, number]>,
  w: number,
  h: number,
  pad = 14
): string | null {
  if (points.length < 2) return null;
  const meanLat = points.reduce((s, p) => s + p[1], 0) / points.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  const xs = points.map((p) => p[0] * k);
  const ys = points.map((p) => -p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1e-6;
  const spanY = Math.max(...ys) - minY || 1e-6;
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  return xs
    .map((x, i) => {
      const px = (offX + (x - minX) * scale).toFixed(1);
      const py = (offY + (ys[i] - minY) * scale).toFixed(1);
      return `${i === 0 ? "M" : "L"}${px} ${py}`;
    })
    .join(" ");
}

/**
 * The vehicles a roadtrip may be given. Rail is not one (owner, 2026-09-25):
 * train journeys are a domain of their own, and `ROADTRIP_VEHICLES` no longer
 * lists it. A row that already says `rail` keeps it on display, so choosing
 * nothing never rewrites it.
 */
export function vehicleChoices<V extends StoredRoadtripVehicle>(
  current: V | null = null
): Array<RoadtripVehicle | V> {
  const offered: Array<RoadtripVehicle | V> = [...ROADTRIP_VEHICLES];
  return current !== null && !offered.includes(current) ? [...offered, current] : offered;
}

export type StationWarning =
  | { kind: "noPlace"; index: number }
  | { kind: "noStay"; index: number }
  | { kind: "beforePrevious"; index: number }
  | { kind: "noDeparture"; index: number };

/**
 * A station while it is edited: the point may still be missing, and a stay
 * night may be chosen before the stay is linked — a state the server
 * refuses, so it waits here instead.
 */
export type StationDraft = Omit<StationInput, "lat" | "lon" | "night"> & {
  lat: number | null;
  lon: number | null;
  night: StationNightInput | { kind: "stay"; lodgingStayId: null };
};

/**
 * What the editor points out. A missing place or an unlinked stay holds the
 * save back (the server needs both); the rest are hints a reader usually
 * wants and may still mean.
 */
export function stationWarnings(drafts: readonly StationDraft[]): StationWarning[] {
  const out: StationWarning[] = [];
  let lastDay: string | null = null;
  drafts.forEach((d, index) => {
    if (d.lat === null || d.lon === null || d.title.trim() === "") {
      out.push({ kind: "noPlace", index });
    }
    if (d.night.kind === "stay" && !d.night.lodgingStayId) {
      out.push({ kind: "noStay", index });
    }
    const day = dayKey(d.startDate ?? null);
    if (day !== null && lastDay !== null && day < lastDay) {
      out.push({ kind: "beforePrevious", index });
    }
    if (day !== null) lastDay = dayKey(d.endDate ?? null) ?? day;
    if (d.night.kind === "free" && day !== null && !d.endDate) {
      out.push({ kind: "noDeparture", index });
    }
  });
  return out;
}

/** A draft the server accepts: it has a place, and a stay night has its stay. */
export function isSavable(
  d: StationDraft
): d is StationDraft & { lat: number; lon: number; night: StationNightInput } {
  const stayLinked = d.night.kind !== "stay" || Boolean(d.night.lodgingStayId);
  return d.title.trim() !== "" && d.lat !== null && d.lon !== null && stayLinked;
}

/** The morning after a day, for the "left next morning" shortcut. */
export function nextMorning(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`) + DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * A station inserted after another starts where that one left off: dated the
 * day it was left, a free night — the most common thing a reader adds
 * between two planned stops. The place is searched, never guessed.
 */
export function stationAfter(before: StationDraft | null): StationDraft {
  return {
    title: "",
    lat: null,
    lon: null,
    startDate: before?.endDate ?? before?.startDate ?? null,
    endDate: null,
    notes: null,
    night: { kind: "free" },
  };
}

export interface RoadtripGroups<T> {
  underway: T[];
  /** Soonest first — the next trip is the one a reader is planning. */
  planned: T[];
  /** Newest year first, newest trip first within a year. */
  years: Array<{ year: number; rows: T[] }>;
  undated: T[];
}

/**
 * The list's sections: on the road now, planned, then past trips by the
 * year they started, and the undated ones last. One place decides which
 * section a roadtrip is in, so the card's "Geplant" pill and the section it
 * sits under can never disagree.
 */
export function groupRoadtrips<T extends { startDate: string | null; endDate: string | null }>(
  rows: readonly T[],
  today: string
): RoadtripGroups<T> {
  const groups: RoadtripGroups<T> = { underway: [], planned: [], years: [], undated: [] };
  const byYear = new Map<number, T[]>();
  for (const row of rows) {
    const phase = roadtripPhase(row.startDate, row.endDate, today);
    if (phase === "undated") groups.undated.push(row);
    else if (phase === "planned") groups.planned.push(row);
    else if (phase === "underway") groups.underway.push(row);
    else {
      const year = Number((row.startDate as string).slice(0, 4));
      byYear.set(year, [...(byYear.get(year) ?? []), row]);
    }
  }
  const start = (r: T): string => r.startDate ?? "";
  groups.planned.sort((a, b) => start(a).localeCompare(start(b)));
  groups.years = [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, list]) => ({
      year,
      rows: [...list].sort((a, b) => start(b).localeCompare(start(a))),
    }));
  return groups;
}
