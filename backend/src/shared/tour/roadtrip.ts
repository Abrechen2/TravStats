/**
 * The roadtrip vocabulary and the ONE rule for counting a roadtrip's nights.
 * Mirrored at `frontend/src/shared/tour/roadtrip.ts` — change both together.
 *
 * Design: docs/superpowers/specs/2026-09-24-roadtrips-and-day-tours-design.md.
 */
import { resolveStayTiming, type TimedStay } from "../lodgingTiming";

/** Which page owns a `TripRoute` row. Every leg/track feature ignores it. */
export const ROUTE_KINDS = ["tour", "roadtrip"] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

/** What a day tour was — the thing a person says, not the leg mode. */
export const TOUR_ACTIVITIES = [
  "hike",
  "walk",
  "run",
  "bike",
  "mtb",
  "ski",
  "paddle",
  "climb",
  "other",
] as const;
export type TourActivity = (typeof TOUR_ACTIVITIES)[number];

/** What a roadtrip travelled in. A free field, not a catalog (owner, 2026-09-24). */
export const ROADTRIP_VEHICLES = [
  "motorhome",
  "campervan",
  "caravan",
  "car",
  "motorcycle",
  "bicycle",
  "rail",
  "other",
] as const;
export type RoadtripVehicle = (typeof ROADTRIP_VEHICLES)[number];

/**
 * A station is exactly one of three things. Derived from two columns and
 * never stored as an enum — see `TripStop.overnight` in schema.prisma.
 */
export const STATION_STATES = ["stay", "free", "pass"] as const;
export type StationState = (typeof STATION_STATES)[number];

export function stationState(stop: {
  lodgingStayId: string | null;
  overnight: boolean;
}): StationState {
  if (stop.lodgingStayId !== null) return "stay";
  return stop.overnight ? "free" : "pass";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daySpan(from: Date, to: Date): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.max(0, Math.round((end - start) / DAY_MS));
}

export interface CountableStation {
  lodgingStayId: string | null;
  overnight: boolean;
  startDate: Date | null;
  endDate: Date | null;
  /** The linked stay's timing, when `lodgingStayId` is set and the stay was loaded. */
  stay: TimedStay | null;
}

export interface RoadtripNights {
  /** Nights at recorded accommodation — the SAME figure the lodging statistics hold. */
  stayNights: number;
  /** Nights at a free station, which no lodging statistic knows about. */
  freeNights: number;
  nights: number;
  /** False as soon as one overnight station's length is not actually known. */
  nightsKnown: boolean;
  /** Distinct places slept: linked stays (once each) plus free stations. */
  placesSlept: number;
}

/**
 * The stay owns the night: a linked station contributes the stay's own night
 * count, resolved by `resolveStayTiming` exactly as the lodging statistics
 * resolve it, and a stay linked from two stations counts once. Only a free
 * station counts its nights itself — from its dates, or as one night when it
 * carries none, because `overnight` asserts that a night happened.
 */
export function countRoadtripNights(stations: readonly CountableStation[]): RoadtripNights {
  const seenStays = new Set<string>();
  let stayNights = 0;
  let freeNights = 0;
  let nightsKnown = true;
  let placesSlept = 0;

  for (const station of stations) {
    const state = stationState(station);
    if (state === "pass") continue;

    if (state === "stay") {
      const id = station.lodgingStayId as string;
      if (seenStays.has(id)) continue;
      seenStays.add(id);
      placesSlept++;
      if (station.stay === null) {
        nightsKnown = false;
        continue;
      }
      const timing = resolveStayTiming(station.stay);
      stayNights += timing.nights;
      if (!timing.nightsKnown) nightsKnown = false;
      continue;
    }

    placesSlept++;
    if (station.startDate && station.endDate) {
      freeNights += Math.max(1, daySpan(station.startDate, station.endDate));
    } else {
      freeNights += 1;
      if (!station.startDate) nightsKnown = false;
    }
  }

  return { stayNights, freeNights, nights: stayNights + freeNights, nightsKnown, placesSlept };
}
