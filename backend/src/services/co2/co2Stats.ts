import { calculateCo2Kg, toSeatClass } from "../co2Calculator";
import { loadCountableCo2Rows } from "../evidence/flightPopulations";
import { EMISSION_FACTOR_SOURCE } from "../../shared/emissionFactors";
import {
  loadBusCo2Items,
  loadCruiseCo2Items,
  loadFerryCo2Items,
  loadRailCo2Items,
  loadRentalCo2Items,
  type Co2Item,
} from "./co2Rows";
import type { Co2Mode } from "./transportCo2";

/**
 * `GET /stats/co2` (forgejo#395): carbon per mode, lifetime.
 *
 * Every mode is its own figure with its own coverage; `totalKg` is the one
 * place they are added, and it names each part so the sum is never read as one
 * undifferentiated number (the modes use different bases: per passenger-km,
 * per vehicle-km, and the cruise proxy is a lower bound).
 *
 * Abstention is a result: a mode with records but no measurable one has
 * `kg: null`, not 0, and `measured < records` says how much of it answered.
 */
export interface Co2KindStats {
  /** The factor row, e.g. `rail.national`. */
  factor: string;
  rides: number;
  kg: number;
}

export interface Co2ModeStats {
  mode: Co2Mode;
  /** Records in the mode's counting population. */
  records: number;
  /** Of those, how many carry an estimate. */
  measured: number;
  /** Null when `measured` is 0. */
  kg: number | null;
  distanceKm: number;
  /** True when any contributing figure understates by construction (cruise). */
  lowerBound: boolean;
  kinds: Co2KindStats[];
  /** Net kg versus flying the same chords; null when no ride was comparable. */
  savedVsFlightKg: number | null;
  comparedRides: number;
}

export interface Co2Stats {
  flights: { records: number; measured: number; kg: number | null };
  modes: Co2ModeStats[];
  /** Flights plus every mode with a figure; null when nothing has one. */
  totalKg: number | null;
  /** Net saving over rail and bus rides that had a flight to compare with. */
  savedVsFlightKg: number | null;
  comparedRides: number;
  source: typeof EMISSION_FACTOR_SOURCE;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function foldMode<R>(mode: Co2Mode, items: Co2Item<R>[]): Co2ModeStats {
  const measured = items.filter((i) => i.estimate !== null);
  const kinds = new Map<string, Co2KindStats>();
  let kg = 0;
  let distanceKm = 0;
  let saved = 0;
  let compared = 0;
  for (const { estimate } of measured) {
    if (estimate === null) continue;
    kg += estimate.kg;
    distanceKm += estimate.distanceKm;
    const kind = kinds.get(estimate.factor) ?? { factor: estimate.factor, rides: 0, kg: 0 };
    kinds.set(estimate.factor, {
      ...kind,
      rides: kind.rides + 1,
      kg: round1(kind.kg + estimate.kg),
    });
    if (estimate.savedKg !== null) {
      saved += estimate.savedKg;
      compared += 1;
    }
  }
  return {
    mode,
    records: items.length,
    measured: measured.length,
    kg: measured.length === 0 ? null : round1(kg),
    distanceKm: Math.round(distanceKm),
    lowerBound: measured.some((i) => i.estimate?.lowerBound === true),
    kinds: [...kinds.values()].sort((a, b) => b.kg - a.kg),
    savedVsFlightKg: compared === 0 ? null : round1(saved),
    comparedRides: compared,
  };
}

/** Lifetime, or one trip's share of the same populations when `tripId` is given. */
export async function loadCo2Stats(userId: string, tripId?: string): Promise<Co2Stats> {
  const [flightRows, rail, bus, ferry, cruise, rental] = await Promise.all([
    loadCountableCo2Rows(userId, tripId),
    loadRailCo2Items(userId, tripId),
    loadBusCo2Items(userId, tripId),
    loadFerryCo2Items(userId, tripId),
    loadCruiseCo2Items(userId, tripId),
    loadRentalCo2Items(userId, tripId),
  ]);
  const flightKgs = flightRows
    .map((row) =>
      calculateCo2Kg({
        depLat: row.depLat,
        depLon: row.depLon,
        arrLat: row.arrLat,
        arrLon: row.arrLon,
        seatClass: toSeatClass(row.seatClass),
      })
    )
    .filter((kg): kg is number => kg !== null);
  const flights = {
    records: flightRows.length,
    measured: flightKgs.length,
    kg: flightKgs.length === 0 ? null : flightKgs.reduce((sum, kg) => sum + kg, 0),
  };
  const modes = [
    foldMode("rail", rail),
    foldMode("bus", bus),
    foldMode("ferry", ferry),
    foldMode("cruise", cruise),
    foldMode("rental", rental),
  ];
  const parts = [flights.kg, ...modes.map((m) => m.kg)].filter((kg): kg is number => kg !== null);
  const compared = modes.reduce((sum, m) => sum + m.comparedRides, 0);
  const saved = modes.reduce((sum, m) => sum + (m.savedVsFlightKg ?? 0), 0);
  return {
    flights,
    modes,
    totalKg: parts.length === 0 ? null : round1(parts.reduce((sum, kg) => sum + kg, 0)),
    savedVsFlightKg: compared === 0 ? null : round1(saved),
    comparedRides: compared,
    source: EMISSION_FACTOR_SOURCE,
  };
}
