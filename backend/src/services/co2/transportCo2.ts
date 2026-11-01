import {
  BUS_KG_PER_PKM,
  CAR_KG_PER_VKM,
  CRUISE_PROXY_KG_PER_PKM,
  FERRY_KG_PER_PKM,
  MIN_COMPARABLE_FLIGHT_KM,
  RAIL_KG_PER_PKM,
  type CarFuel,
  type CarSize,
} from "../../shared/emissionFactors";
import { rentalDrivenKm } from "../../shared/rentalCounting";
import { calculateCo2Kg, haversineKm } from "../co2Calculator";

/**
 * CO2 for every mode but flights (forgejo#395). Pure functions over a ride's
 * own columns; the factors and their publication live in
 * `shared/emissionFactors.ts`.
 *
 * Two rules carry the file:
 *
 *  - **Abstention is a result.** No distance, no estimate: `null`, never 0. A
 *    zero would drag every per-mode figure down and read as "emission-free".
 *    Likewise an electric rental car (the publication counts tailpipe only).
 *  - **An estimate says what it stands on.** `factor` names the row used and
 *    `factorKgPerKm` its figure, so the detail page and the evidence panel can
 *    show the arithmetic instead of a bare number.
 */

export interface Co2Estimate {
  /** One decimal. */
  kg: number;
  /** The distance the factor was applied to. */
  distanceKm: number;
  factorKgPerKm: number;
  /** The factor row used, e.g. `rail.national` or `car.medium.diesel`. */
  factor: string;
  /** True when the factor is per vehicle-km (a rental car), not per passenger-km. */
  perVehicle: boolean;
  /** True when the figure understates by construction (the cruise proxy). */
  lowerBound: boolean;
  /** A flight over the same great-circle distance, economy; null when not offered. */
  flightKg: number | null;
  /** `flightKg - kg`: kilograms saved by not flying. Estimate; may be negative. */
  savedKg: number | null;
}

export type Co2Mode = "rail" | "bus" | "ferry" | "cruise" | "rental";
export const CO2_MODES: readonly Co2Mode[] = ["rail", "bus", "ferry", "cruise", "rental"];

const round1 = (n: number): number => Math.round(n * 10) / 10;

function usableKm(km: number | null | undefined): km is number {
  return typeof km === "number" && Number.isFinite(km) && km > 0;
}

interface Ends {
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
}

function build(
  km: number,
  factorKgPerKm: number,
  factor: string,
  extra: Partial<Pick<Co2Estimate, "perVehicle" | "lowerBound">> = {}
): Co2Estimate {
  return {
    kg: round1(km * factorKgPerKm),
    distanceKm: km,
    factorKgPerKm,
    factor,
    perVehicle: extra.perVehicle ?? false,
    lowerBound: extra.lowerBound ?? false,
    flightKg: null,
    savedKg: null,
  };
}

/**
 * "Instead of flying": what the same trip would have emitted as an economy
 * flight over the great-circle distance between the ends, using the existing
 * flight calculator. An estimate in both directions — the ride's distance is
 * the track, the flight's is the chord.
 */
export function withFlightComparison(estimate: Co2Estimate, ends: Ends): Co2Estimate {
  const flightKg = calculateCo2Kg({ ...ends, seatClass: "economy" });
  if (flightKg === null) return estimate;
  // Under the threshold the chord is not a distance anyone would fly.
  const chordKm = haversineKm(ends.depLat, ends.depLon, ends.arrLat, ends.arrLon);
  if (chordKm < MIN_COMPARABLE_FLIGHT_KM) return estimate;
  return { ...estimate, flightKg, savedKg: round1(flightKg - estimate.kg) };
}

export interface RailCo2Row extends Ends {
  distanceKm: number | null;
  transitMode: string;
}

export function railCo2(row: RailCo2Row): Co2Estimate | null {
  if (!usableKm(row.distanceKm)) return null;
  const mode = row.transitMode;
  if (mode !== "rail" && mode !== "tram" && mode !== "metro") return null;
  const estimate = build(row.distanceKm, RAIL_KG_PER_PKM[mode], `rail.${mode}`);
  // A tram or metro line is not a flight's alternative.
  return mode === "rail" ? withFlightComparison(estimate, row) : estimate;
}

export interface BusCo2Row extends Ends {
  distanceKm: number | null;
  rideKind: string | null;
}

/**
 * Intercity and unstated kinds read as a coach (the domain is long-distance
 * services, spec D1); a shuttle as the average local bus. A shuttle is not a
 * flight's alternative.
 */
export function busCo2(row: BusCo2Row): Co2Estimate | null {
  if (!usableKm(row.distanceKm)) return null;
  if (row.rideKind === "shuttle") {
    return build(row.distanceKm, BUS_KG_PER_PKM.local, "bus.local");
  }
  return withFlightComparison(build(row.distanceKm, BUS_KG_PER_PKM.coach, "bus.coach"), row);
}

export interface FerryCo2Row {
  distanceKm: number | null;
  vehicleType: string | null;
  vehicleRegistration: string | null;
}

const filled = (v: string | null | undefined): boolean => typeof v === "string" && v.trim() !== "";

/** A recorded vehicle means "car passenger"; otherwise the all-passenger average. */
export function ferryCo2(row: FerryCo2Row): Co2Estimate | null {
  if (!usableKm(row.distanceKm)) return null;
  return filled(row.vehicleType) || filled(row.vehicleRegistration)
    ? build(row.distanceKm, FERRY_KG_PER_PKM.car, "ferry.car")
    : build(row.distanceKm, FERRY_KG_PER_PKM.average, "ferry.average");
}

/** Over the summed leg distance; null without legs. Always a lower bound. */
export function cruiseCo2(legDistancesKm: readonly number[]): Co2Estimate | null {
  const km = legDistancesKm.filter(usableKm).reduce((sum, d) => sum + d, 0);
  if (!usableKm(km)) return null;
  return build(km, CRUISE_PROXY_KG_PER_PKM, "cruise.ferryAverage", { lowerBound: true });
}

const SMALL = "MNEH";
const MEDIUM = "CDIJSR";
const LARGE = "FGPULWO";

/** ACRISS position 1 → DESNZ size band. A TravStats mapping; `X` (special) and no code → average. */
export function carSizeOf(acrissCode: string | null): CarSize {
  const category = acrissCode?.trim().toUpperCase()[0];
  if (!category) return "average";
  if (SMALL.includes(category)) return "small";
  if (MEDIUM.includes(category)) return "medium";
  if (LARGE.includes(category)) return "large";
  return "average";
}

/** ACRISS position 4 → fuel; `"electric"` is returned apart because it has no factor. */
export function carFuelOf(acrissCode: string | null): CarFuel | "electric" {
  const fuel = acrissCode?.trim().toUpperCase()[3];
  if (fuel === "D" || fuel === "Q") return "diesel";
  if (fuel === "H" || fuel === "I") return "hybrid";
  if (fuel === "E" || fuel === "C") return "electric";
  return "unknown";
}

export interface RentalCo2Row {
  acrissCode: string | null;
  distanceKm: number | null;
  distanceSource: string | null;
  odometerOutKm: number | null;
  odometerInKm: number | null;
}

/** Driven km (`rentalDrivenKm`, the one rule) times the vehicle-km factor of the car's band. */
export function rentalCo2(row: RentalCo2Row): Co2Estimate | null {
  const driven = rentalDrivenKm(row);
  if (driven === null || !usableKm(driven.km)) return null;
  const fuel = carFuelOf(row.acrissCode);
  if (fuel === "electric") return null;
  const size = carSizeOf(row.acrissCode);
  return build(driven.km, CAR_KG_PER_VKM[size][fuel], `car.${size}.${fuel}`, { perVehicle: true });
}
