import { AppError } from "../../middleware/errorHandler";
import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { flightDistinctEvidence, flightSumEvidence } from "./flightMeasureResponse";
import { readYearScope } from "./domainMeasureResponse";
import { airportVisits, firstVisits } from "../stats/flightInsights/airports";
import { connectionFlights, firstFlights } from "../stats/flightInsights/connections";
import { loadFlightInsightRows, type FlightInsightRow } from "../stats/flightInsights/rows";
import { foldTransfers } from "../stats/flightInsights/transfers";

/**
 * The four served flight-insight measures (forgejo#256). Each walks the fold
 * the section's figure comes from (`services/stats/flightInsights/`) over the
 * same load, so the panel names exactly the flights the tile counted.
 *
 * "New" is judged against the WHOLE logbook in every scope — a year scope
 * narrows which first visits are listed, never what counts as first.
 */

const yearOfDay = (day: string): number => Number(day.slice(0, 4));

function inScope(day: string, year: number | undefined): boolean {
  return year === undefined || yearOfDay(day) === year;
}

/** Flights and the units each witnessed, folded per flight id. */
function creditsByFlight(
  pairs: ReadonlyArray<{ flightId: string; credit: string }>
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { flightId, credit } of pairs) {
    const list = out.get(flightId) ?? [];
    if (!list.includes(credit)) out.set(flightId, [...list, credit]);
  }
  return out;
}

function distinctOverRows(
  userId: string,
  key: string,
  unit: string,
  scope: EvidenceScope,
  page: PagingParams,
  rows: readonly FlightInsightRow[],
  credits: Map<string, string[]>
): Promise<EvidenceResponse> {
  return flightDistinctEvidence({
    userId,
    key,
    unit,
    scope,
    page,
    rows: rows.filter((r) => credits.has(r.id)),
    creditsOf: (r) => credits.get(r.id) ?? [],
  });
}

export async function resolveFlightNewAirportsCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "flightNewAirportsCount";
  const year = readYearScope(scope, key);
  const rows = await loadFlightInsightRows(userId);
  const first = [...firstVisits(airportVisits(rows)).values()].filter((v) => inScope(v.day, year));
  const credits = creditsByFlight(first.map((v) => ({ flightId: v.flightId, credit: v.airport })));
  return distinctOverRows(userId, key, "airports", scope, page, rows, credits);
}

export async function resolveFlightNewConnectionsCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "flightNewConnectionsCount";
  const year = readYearScope(scope, key);
  const rows = await loadFlightInsightRows(userId);
  const first = [...firstFlights(connectionFlights(rows)).values()].filter((f) =>
    inScope(f.day, year)
  );
  const credits = creditsByFlight(
    first.map((f) => ({ flightId: f.flightId, credit: f.connection }))
  );
  return distinctOverRows(userId, key, "connections", scope, page, rows, credits);
}

export async function resolveFlightRepeatedConnectionsCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "flightRepeatedConnectionsCount";
  // "Again" needs an earlier year to have been flown in; lifetime has none.
  if (scope.period.kind !== "year") {
    throw new AppError(
      `${key} evidence only supports period=year; got period=${scope.period.kind}.`,
      400
    );
  }
  const year = scope.period.year;
  const rows = await loadFlightInsightRows(userId);
  const flights = connectionFlights(rows);
  const first = firstFlights(flights);
  const repeated = flights.filter((f) => f.year === year && first.get(f.connection)!.year < year);
  const credits = creditsByFlight(
    repeated.map((f) => ({ flightId: f.flightId, credit: f.connection }))
  );
  return distinctOverRows(userId, key, "connections", scope, page, rows, credits);
}

export async function resolveFlightTransferCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "flightTransferCount";
  const year = readYearScope(scope, key);
  const rows = await loadFlightInsightRows(userId);
  const arriving = new Set(
    foldTransfers(rows)
      .transfers.filter((t) => inScope(t.day, year))
      .map((t) => t.arrivingFlightId)
  );
  return flightSumEvidence({
    userId,
    key,
    unit: "transfers",
    scope,
    page,
    rows: rows.filter((r) => arriving.has(r.id)),
  });
}
