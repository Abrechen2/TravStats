/**
 * The leaderboard's metric catalogue (comparison rework 2026-10-16): which totals a snapshot
 * may carry, how they group, which domain colours them, and their unit.
 *
 * MIRRORED byte-for-byte between backend/src/shared and frontend/src/shared; change both
 * together. frontend/src/shared/__tests__/comparisonMetrics.mirror.test.ts fails when they differ.
 *
 * Adding a metric is NOT a snapshot version change (spec §10): a receiver ignores keys its own
 * catalogue does not know. Changing what a key MEANS is.
 */
import type { DomainKey } from "./domains";

export const METRIC_GROUPS = ["distance", "trips", "time", "places"] as const;
export type MetricGroup = (typeof METRIC_GROUPS)[number];
export type MetricUnit = "km" | "count" | "minutes" | "days" | "nights";

export interface MetricDef {
  key: string;
  group: MetricGroup;
  /** null: a cross-domain figure, derivable only when every visible domain is shared. */
  domain: DomainKey | null;
  unit: MetricUnit;
}

export const LEADERBOARD_METRICS = [
  { key: "flightKm", group: "distance", domain: "flight", unit: "km" },
  { key: "cruiseKm", group: "distance", domain: "cruise", unit: "km" },
  { key: "railKm", group: "distance", domain: "rail", unit: "km" },
  { key: "busKm", group: "distance", domain: "bus", unit: "km" },
  { key: "rentalKm", group: "distance", domain: "rental", unit: "km" },
  { key: "ferryKm", group: "distance", domain: "ferry", unit: "km" },
  { key: "tourKm", group: "distance", domain: "roadtrip", unit: "km" },
  { key: "flights", group: "trips", domain: "flight", unit: "count" },
  { key: "cruises", group: "trips", domain: "cruise", unit: "count" },
  { key: "stays", group: "trips", domain: "lodging", unit: "count" },
  { key: "railRides", group: "trips", domain: "rail", unit: "count" },
  { key: "busRides", group: "trips", domain: "bus", unit: "count" },
  { key: "rentals", group: "trips", domain: "rental", unit: "count" },
  { key: "ferryCrossings", group: "trips", domain: "ferry", unit: "count" },
  { key: "tours", group: "trips", domain: "roadtrip", unit: "count" },
  { key: "placeVisits", group: "trips", domain: "poi", unit: "count" },
  { key: "flightMinutes", group: "time", domain: "flight", unit: "minutes" },
  { key: "nights", group: "time", domain: "lodging", unit: "nights" },
  { key: "rentalDays", group: "time", domain: "rental", unit: "days" },
  { key: "daysAway", group: "time", domain: null, unit: "days" },
  { key: "countries", group: "places", domain: null, unit: "count" },
  { key: "cruisePorts", group: "places", domain: "cruise", unit: "count" },
  { key: "places", group: "places", domain: "poi", unit: "count" },
] as const satisfies readonly MetricDef[];

export type MetricKey = (typeof LEADERBOARD_METRICS)[number]["key"];
export const METRIC_KEYS: readonly MetricKey[] = LEADERBOARD_METRICS.map((m) => m.key);

export function isMetricKey(value: string): value is MetricKey {
  return (METRIC_KEYS as readonly string[]).includes(value);
}
