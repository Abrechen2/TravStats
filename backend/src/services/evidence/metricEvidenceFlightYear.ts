import { AppError } from "../../middleware/errorHandler";
import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { flightDateOf, hydrateFlightSumEntries } from "./entryMappers";
import { buildWhere, computeSummary, type SummaryFlightRow } from "../stats/summary";
import { getBaseCurrency } from "../fx/snapshot";

/**
 * `yearFlightCount` / `yearDistanceKm` / `yearFlightTimeMinutes` /
 * `yearTotalCost` / `yearUnpricedFlightCount` — `FlightYearSummaryCards`,
 * fed by `GET /stats/summary?year=`, i.e. `services/stats/summary.ts`
 * `computeSummary`. That function used to fold every row into its totals and
 * let the rows go out of scope (task-7-brief.md) — it now returns
 * `{ stats, rows }` over the SAME query and the SAME predicate, and every
 * resolver here reads `rows` rather than re-deriving anything. Paging and
 * hydration are shared via `entryMappers.ts`, not re-derived per resolver.
 */

function requireYear(scope: EvidenceScope, label: string): number {
  if (scope.period.kind !== "year") {
    throw new AppError(
      `${label} evidence only supports period=year; got period=${scope.period.kind}.`,
      400
    );
  }
  return scope.period.year;
}

async function loadYearRows(
  userId: string,
  year: number
): Promise<{
  rows: SummaryFlightRow[];
  stats: Awaited<ReturnType<typeof computeSummary>>["stats"];
}> {
  const baseCurrency = await getBaseCurrency(userId);
  const where = await buildWhere(userId, undefined, undefined, year);
  const { stats, rows } = await computeSummary(where, baseCurrency);
  return { rows, stats };
}

export async function resolveYearFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const year = requireYear(scope, "yearFlightCount");
  const { rows, stats } = await loadYearRows(userId, year);
  const matched = rows.map((r) => ({
    id: r.id,
    date: flightDateOf(r.departureTime),
    contribution: 1,
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    matched,
    page
  );
  return {
    measure: {
      kind: "metric",
      key: "yearFlightCount",
      aggregation: "sum",
      label: { key: "evidence.metric.yearFlightCount", values: { year } },
      unit: "flights",
      value: stats.totalFlights,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}

export async function resolveYearDistanceKm(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const year = requireYear(scope, "yearDistanceKm");
  const { rows, stats } = await loadYearRows(userId, year);
  const matched = rows.map((r) => ({
    id: r.id,
    date: flightDateOf(r.departureTime),
    contribution: r.distanceKm,
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    matched,
    page
  );
  return {
    measure: {
      kind: "metric",
      key: "yearDistanceKm",
      aggregation: "sum",
      label: { key: "evidence.metric.yearDistanceKm", values: { year } },
      unit: "km",
      value: stats.totalDistance,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}

export async function resolveYearFlightTimeMinutes(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const year = requireYear(scope, "yearFlightTimeMinutes");
  const { rows, stats } = await loadYearRows(userId, year);
  const matched = rows.map((r) => ({
    id: r.id,
    date: flightDateOf(r.departureTime),
    contribution: r.durationMinutes ?? 0,
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    matched,
    page
  );
  return {
    measure: {
      kind: "metric",
      key: "yearFlightTimeMinutes",
      aggregation: "sum",
      label: { key: "evidence.metric.yearFlightTimeMinutes", values: { year } },
      unit: "minutes",
      value: stats.totalFlightTime,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}

/**
 * `stats.totalCost` is `null` (forgejo#83) when no flight's amount reached
 * the base currency this year — see the matching note on `businessTotalCost`
 * in `metricEvidenceFlightCore.ts` for why `notPerEntry` is the nearest of
 * the three closed `UnattributedReason`s rather than an exact fit.
 */
export async function resolveYearTotalCost(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const year = requireYear(scope, "yearTotalCost");
  const { rows, stats } = await loadYearRows(userId, year);
  const matched = rows.map((r) => ({
    id: r.id,
    date: flightDateOf(r.departureTime),
    contribution: r.costContributionBase,
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    matched,
    page
  );
  const unattributed =
    stats.totalCost === null ? [{ count: rows.length, reason: "notPerEntry" as const }] : [];
  return {
    measure: {
      kind: "metric",
      key: "yearTotalCost",
      aggregation: "sum",
      label: { key: "evidence.metric.yearTotalCost", values: { year } },
      unit: "currency",
      value: stats.totalCost,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed,
    page,
  };
}

export async function resolveYearUnpricedFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const year = requireYear(scope, "yearUnpricedFlightCount");
  const { rows, stats } = await loadYearRows(userId, year);
  const matched = rows
    .filter((r) => !r.priced)
    .map((r) => ({ id: r.id, date: flightDateOf(r.departureTime), contribution: 1 }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    matched,
    page
  );
  return {
    measure: {
      kind: "metric",
      key: "yearUnpricedFlightCount",
      aggregation: "sum",
      label: { key: "evidence.metric.yearUnpricedFlightCount", values: { year } },
      unit: "flights",
      value: stats.unpricedFlights,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}
