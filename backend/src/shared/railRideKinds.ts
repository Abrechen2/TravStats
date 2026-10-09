/**
 * What KIND of train ride this was — night train, high-speed, across a border —
 * and how far it counts. One home for the questions the rail badges ask
 * (`utils/railAchievements.ts`) and the evidence panel behind them
 * (`services/evidence/metricEvidenceRail.ts`), so a badge and the list of rides
 * that earned it cannot disagree.
 *
 * Which rides count at all is NOT decided here: that is `railCounting.ts`
 * (completed only, cancelled never). Every function below is asked only about
 * rides that already passed that rule.
 *
 * Backend only: no frontend surface classifies rides yet.
 */

import { rideHasClocks } from "./railClock";
import { localDay } from "./time/instant";

/**
 * Categories whose trains run at 200 km/h or more on their main lines. Matched
 * against the FIRST word of `trainCategory`, upper-cased, so "TGV INOUI",
 * "ICE Sprinter" and "ice" all resolve. A category not listed is not a guess
 * of "slow" — it is simply not proven fast, and the badge counts what is proven.
 */
export const HIGH_SPEED_CATEGORIES: ReadonlySet<string> = new Set([
  "ICE", // DB
  "ECE", // EuroCity-Express (ICE sets Frankfurt–Milano)
  "TGV", // SNCF, incl. "TGV INOUI", "TGV Lyria"
  "INOUI",
  "OUIGO",
  "EST", // Eurostar
  "THA", // Thalys (now Eurostar)
  "FR", // Frecciarossa
  "FA", // Frecciargento
  "ITA", // Italo
  "AVE", // Renfe
  "AVLO",
  "IRYO",
  "RJ", // ÖBB Railjet, 230 km/h
  "RJX",
  "X2000", // SJ Snabbtåg
  "SHINKANSEN",
  "KTX",
]);

/** Night-train categories: ÖBB Nightjet, EuroNight, the generic "Nachtzug". */
export const NIGHT_TRAIN_CATEGORIES: ReadonlySet<string> = new Set(["NJ", "EN", "NZ"]);

/** Classes that only exist on a night train. */
const NIGHT_CLASSES: ReadonlySet<string> = new Set(["sleeper", "couchette"]);

/**
 * A ride without a sleeper, a couchette or a night category still counts as a
 * night train when it runs overnight: it arrives on a LATER day of its arrival
 * station's calendar than it left on its departure station's, after at least
 * this long on board. The floor keeps a 23:40 regional train that arrives at
 * 00:20 out — it crossed midnight, nobody slept on it.
 */
export const OVERNIGHT_MIN_HOURS = 6;

export interface RailRideKindInput {
  trainCategory: string | null;
  travelClass: string | null;
  depCountry: string | null;
  arrCountry: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  /** `YYYY-MM-DD` of departure and arrival on their stations' clocks. */
  depDayKey: string;
  arrDayKey: string | null;
  /** ADR 0002 precision of each end; null = written before the column (minute). */
  depPrecision: string | null;
  arrPrecision: string | null;
}

/** The first word of the category, upper-cased — or null when none was recorded. */
export function categoryKey(trainCategory: string | null): string | null {
  const first = trainCategory?.trim().split(/\s+/)[0];
  return first ? first.toUpperCase() : null;
}

export function isHighSpeedRide(ride: Pick<RailRideKindInput, "trainCategory">): boolean {
  const key = categoryKey(ride.trainCategory);
  return key !== null && HIGH_SPEED_CATEGORIES.has(key);
}

export function isNightTrainRide(
  ride: Omit<RailRideKindInput, "depCountry" | "arrCountry">
): boolean {
  if (ride.travelClass && NIGHT_CLASSES.has(ride.travelClass)) return true;
  const key = categoryKey(ride.trainCategory);
  if (key !== null && NIGHT_TRAIN_CATEGORIES.has(key)) return true;
  if (!ride.arrivalTime || !ride.arrDayKey) return false;
  // A date-only ride (forgejo#132 item 17) is stored at the starts of its days:
  // "left on the 5th, arrived on the 6th" would read as 24 h overnight. Without
  // both clocks there is no evidence it ran through the night.
  if (!rideHasClocks(ride)) return false;
  const hours = (ride.arrivalTime.getTime() - ride.departureTime.getTime()) / 3_600_000;
  return ride.arrDayKey > ride.depDayKey && hours >= OVERNIGHT_MIN_HOURS;
}

/** What `nightTrainNights` reads: the ride's kind, its two instants and their stations' zones. */
export interface NightTrainFacts {
  trainCategory: string | null;
  travelClass: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  depPrecision: string | null;
  arrPrecision: string | null;
}

/**
 * The nights slept on a night train, as `YYYY-MM-DD` night-starting days on
 * the STATIONS' calendars: from the departure day (inclusive) to the arrival
 * day (exclusive) — Wien 22:58 on the 31st to Hamburg 09:00 on the 1st is the
 * night of the 31st, a night of the old year (forgejo#266).
 *
 * `[]` for a ride that is not a night train (`isNightTrainRide`), or one that
 * arrives on its departure day. `null` for a night train whose arrival day is
 * unknown: a night was slept on board, and no calendar can hold it. A
 * clockless ride counts by its days — a sleeper booked for the 5th to the 6th
 * is the night of the 5th — but only when its class or category says it is a
 * night train; by the clock alone it never is (`isNightTrainRide`).
 *
 * Which rides count at all stays `railCounting`'s question (completed only).
 */
export function nightTrainNights(ride: NightTrainFacts): string[] | null {
  // A station with no zone stored its wall clock as UTC (rail's abstention),
  // so UTC is the honest way back — `railCounting.stationDayKey`'s rule.
  const depDayKey = localDay(ride.departureTime, ride.depTimezone ?? "UTC");
  const arrDayKey = ride.arrivalTime ? localDay(ride.arrivalTime, ride.arrTimezone ?? "UTC") : null;
  if (!isNightTrainRide({ ...ride, depDayKey, arrDayKey })) return [];
  if (arrDayKey === null) return null;
  const nights: string[] = [];
  for (
    let cursor = Date.parse(`${depDayKey}T00:00:00Z`);
    cursor < Date.parse(`${arrDayKey}T00:00:00Z`);
    cursor += 86_400_000
  ) {
    nights.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return nights;
}

/**
 * A ride from one country into another. Both countries must be KNOWN: a
 * station the geocoder could not place is not evidence of a border, in either
 * direction.
 */
export function isCrossBorderRide(
  ride: Pick<RailRideKindInput, "depCountry" | "arrCountry">
): boolean {
  const dep = ride.depCountry?.trim().toUpperCase();
  const arr = ride.arrCountry?.trim().toUpperCase();
  return Boolean(dep && arr && dep !== arr);
}

/** An operator's identity: trimmed, case and inner spacing folded — "DB  Fernverkehr" = "db fernverkehr". */
export function operatorKey(operator: string | null): string | null {
  const key = operator?.trim().replace(/\s+/g, " ").toLowerCase();
  return key ? key : null;
}

/**
 * The kilometres a ride counts for, whatever its `distanceSource`: the traced
 * line, the ticket's figure, a converted roadtrip line, or the straight line
 * between the stations.
 *
 * Straight-line km COUNT, and that is a deliberate choice: a track is never
 * shorter than the chord between its ends, so the great-circle figure is a
 * LOWER bound of the distance really travelled (by 10–30 %, spec
 * 2026-09-25-rail-domain). A badge reached on it was reached on the rails too;
 * leaving it out would deny every ride logged before routing existed. The
 * statistics still label each source (owner decision 7) — a badge threshold is
 * a yes/no and needs no label, a figure on screen does.
 *
 * A ride with no distance at all counts for nothing, never for zero.
 */
export function rideKm(ride: { distanceKm: number | null }): number | null {
  return typeof ride.distanceKm === "number" &&
    Number.isFinite(ride.distanceKm) &&
    ride.distanceKm > 0
    ? ride.distanceKm
    : null;
}
