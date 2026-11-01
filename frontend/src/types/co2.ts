/**
 * Frontend mirror of `backend/src/services/co2/transportCo2.ts` (`Co2Estimate`)
 * and `co2Stats.ts` (`Co2Stats`), forgejo#395. Every figure is an estimate and
 * is labelled as one wherever it is shown.
 */
export interface Co2Estimate {
  /** One decimal. */
  kg: number;
  distanceKm: number;
  factorKgPerKm: number;
  /** The factor row used, e.g. `rail.rail` or `car.medium.diesel`. */
  factor: string;
  /** True for a rental car: the factor is per vehicle-km, not per passenger-km. */
  perVehicle: boolean;
  /** True when the figure understates by construction (the cruise proxy). */
  lowerBound: boolean;
  /** An economy flight over the same great-circle distance; null when not offered. */
  flightKg: number | null;
  /** `flightKg - kg`; positive = kilograms saved by not flying. */
  savedKg: number | null;
}

export type Co2Mode = "rail" | "bus" | "ferry" | "cruise" | "rental";

export interface Co2ModeStats {
  mode: Co2Mode;
  records: number;
  measured: number;
  /** Null when no record could be measured, never 0. */
  kg: number | null;
  distanceKm: number;
  lowerBound: boolean;
  kinds: Array<{ factor: string; rides: number; kg: number }>;
  savedVsFlightKg: number | null;
  comparedRides: number;
}

export interface Co2Stats {
  flights: { records: number; measured: number; kg: number | null };
  modes: Co2ModeStats[];
  totalKg: number | null;
  savedVsFlightKg: number | null;
  comparedRides: number;
  source: { publisher: string; title: string; year: number; url: string };
}
