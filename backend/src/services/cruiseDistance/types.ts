/**
 * Cruise leg distance calculation — type contracts.
 *
 * Each Calculator implements distance-from-A-to-B and tags the output
 * with provenance so we know how a leg was routed and whether it
 * needs recomputation later (e.g. when the underlying data version
 * bumps). See backend/prisma/migrations/20260428120000_add_cruise_legs.
 */

export type DistanceMethod =
  | "haversine"
  | "eurostat"
  | "river-osm"
  | "canal-heuristic";

export type Confidence = "high" | "medium" | "low";

export interface PortPoint {
  id: number;
  lat: number;
  lon: number;
  unlocode: string | null;
  region: string | null;
}

export interface ComputedLeg {
  distanceKm: number;
  method: DistanceMethod;
  routerVersion: string;
  dataVersion: string | null;
  confidence: Confidence;
  notes: string | null;
}

export interface DistanceCalculator {
  readonly method: DistanceMethod;
  readonly routerVersion: string;
  /**
   * Returns true if this calculator considers itself authoritative
   * for the given port pair. The orchestrator tries calculators in
   * priority order and uses the first that both accepts AND returns
   * a non-null result. Haversine is the always-true fallback at the
   * bottom of the chain.
   */
  accepts(from: PortPoint, to: PortPoint): boolean;
  /**
   * Compute the routed distance. Returning `null` means "after
   * inspection I decline this leg" — the orchestrator continues
   * down the chain. Throwing means a hard failure and the
   * orchestrator logs + skips. Haversine never returns null.
   */
  compute(from: PortPoint, to: PortPoint): Promise<ComputedLeg | null>;
}
