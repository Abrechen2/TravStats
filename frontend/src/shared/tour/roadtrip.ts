/**
 * The roadtrip vocabulary and the ONE rule for counting a roadtrip's nights.
 * Mirror of `backend/src/shared/tour/roadtrip.ts` — change both together.
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

/**
 * What a roadtrip travels in — what a NEW or changed roadtrip may say. A free
 * field, not a catalog (owner, 2026-09-24).
 *
 * `rail` is not one any more (owner, 2026-09-25): train journeys are a domain
 * of their own, and a section by rail is offered for conversion into rail
 * journeys instead (`POST /rail/roadtrip-conversion/:routeId`).
 */
export const ROADTRIP_VEHICLES = [
  "motorhome",
  "campervan",
  "caravan",
  "car",
  "motorcycle",
  "bicycle",
  "other",
] as const;
export type RoadtripVehicle = (typeof ROADTRIP_VEHICLES)[number];

/**
 * Values a STORED roadtrip may still carry that no write accepts any more. A
 * row written before 2026-09-25 can say `rail`; it keeps loading and keeps its
 * label, and nothing rewrites it behind the user's back — only the conversion
 * the user confirms, or the user picking another vehicle, changes it.
 */
export const LEGACY_ROADTRIP_VEHICLES = ["rail"] as const;
export type LegacyRoadtripVehicle = (typeof LEGACY_ROADTRIP_VEHICLES)[number];

/** Every vehicle a roadtrip can be READ with: the current ones and the legacy ones. */
export const STORED_ROADTRIP_VEHICLES = [
  ...ROADTRIP_VEHICLES,
  ...LEGACY_ROADTRIP_VEHICLES,
] as const;
export type StoredRoadtripVehicle = RoadtripVehicle | LegacyRoadtripVehicle;

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
  /**
   * The linked stay's timing, when `lodgingStayId` is set and the stay was
   * loaded. `status` is read for one value only: a cancelled stay is a night
   * that did not happen.
   */
  stay: (TimedStay & { status?: string }) | null;
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
      // Cancelled counts nowhere, exactly as `classifyStay` rules for the
      // lodging statistics: no night and no place slept. The user said so,
      // which is why the stored status is enough here without deriving.
      if (station.stay?.status === "cancelled") continue;
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
