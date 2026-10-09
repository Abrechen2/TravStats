/**
 * Evidence measures — the flight insights section (forgejo#256): discovery,
 * network growth and transfer times. Each is folded by
 * `services/stats/flightInsights/` over ONE load, and the resolver walks the
 * same fold, so the flights listed behind a figure are exactly the ones it
 * counted.
 *
 * MIRRORED at `backend/src/shared/evidenceMeasuresFlightInsights.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const CALCULATOR =
  "services/evidence/metricEvidenceFlightInsights.ts over services/stats/flightInsights/";

const insight = (
  aggregation: "sum" | "distinct",
  unit: string,
  scopes: MeasureSpec["scopes"]
): MeasureSpec => ({
  aggregation,
  unit,
  scopes,
  surface: "FlightInsightsSection",
  calculator: CALCULATOR,
  servedIn: 1,
});

export const FLIGHT_INSIGHT_MEASURES: Record<string, MeasureSpec> = {
  /** Airports first recorded in the scope — the whole logbook is the reference. */
  flightNewAirportsCount: insight("distinct", "airports", ["allTime", "year"]),
  /** Connections (unordered airport pairs) first flown in the scope. */
  flightNewConnectionsCount: insight("distinct", "connections", ["allTime", "year"]),
  /** Connections flown in the year that were already flown in an earlier one. */
  flightRepeatedConnectionsCount: insight("distinct", "connections", ["year"]),
  /** Measured changes of planes within one booking, filed under the landing's year. */
  flightTransferCount: insight("sum", "transfers", ["allTime", "year"]),
};
