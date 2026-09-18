import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { flightDateOf, hydrateFlightSumEntries } from "./entryMappers";
import { fetchFlightDatedRows } from "../stats/timeseriesRows";
import { resolveWindow, withinWindow, type DatedRow } from "../../utils/stats/timeseries";

/**
 * `scorecardFlightCount` / `scorecardDistanceKm` / `scorecardFlightTimeMinutes`
 * — `scorecard/FlightScorecardBlock`, fed by `GET /stats/timeseries`
 * (`services/stats/timeseriesRows.ts` `fetchFlightDatedRows`). Unlike every
 * other flight-tab measure in this feature, this ONE surface is genuinely
 * user-selectable across `rolling12m`/`year`/`allTime` (registry
 * `scopes: ["rolling12m", "year", "allTime"]`) — `resolveWindow` and
 * `withinWindow` are the exact two functions the route calls to decide the
 * bounds and trim the fetcher's deliberate day-wide over-fetch, reused here
 * unchanged so evidence can never disagree with the tile about what is IN
 * the window. Paging and hydration are shared via `entryMappers.ts`, not
 * re-derived here.
 */

function windowFor(scope: EvidenceScope): ReturnType<typeof resolveWindow> {
  const now = new Date();
  if (scope.period.kind === "year") {
    return resolveWindow("year", scope.period.year, undefined, undefined, now);
  }
  if (scope.period.kind === "rolling12m") {
    return resolveWindow("rolling12m", undefined, undefined, undefined, now);
  }
  return resolveWindow("all", undefined, undefined, undefined, now);
}

async function loadScorecardRows(userId: string, scope: EvidenceScope): Promise<DatedRow[]> {
  const w = windowFor(scope);
  const fetched = await fetchFlightDatedRows(userId, w.from, w.to);
  return withinWindow(fetched, w.from, w.to);
}

/**
 * `fetchFlightDatedRows` always sets `id` (this file's whole reason for
 * existing); the cruise fetcher does not, and `DatedRow.id` is optional
 * because of it. A row with no id cannot become evidence — filtered out
 * rather than crashing, though the flight fetcher this resolver calls never
 * produces one.
 */
function withId(rows: DatedRow[]): Array<DatedRow & { id: string }> {
  return rows.filter((r): r is DatedRow & { id: string } => typeof r.id === "string");
}

export async function resolveScorecardFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const rows = withId(await loadScorecardRows(userId, scope));
  const matched = rows.map((r) => ({ id: r.id, date: flightDateOf(r.date), contribution: 1 }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    matched,
    page
  );
  return {
    measure: {
      kind: "metric",
      key: "scorecardFlightCount",
      aggregation: "sum",
      label: { key: "evidence.metric.scorecardFlightCount" },
      unit: "flights",
      value: rows.length,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}

export async function resolveScorecardDistanceKm(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const rows = withId(await loadScorecardRows(userId, scope));
  const matched = rows.map((r) => ({
    id: r.id,
    date: flightDateOf(r.date),
    contribution: r.distanceKm,
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    matched,
    page
  );
  const total = matched.reduce((sum, m) => sum + m.contribution, 0);
  return {
    measure: {
      kind: "metric",
      key: "scorecardDistanceKm",
      aggregation: "sum",
      label: { key: "evidence.metric.scorecardDistanceKm" },
      unit: "km",
      value: total,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}

export async function resolveScorecardFlightTimeMinutes(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const rows = withId(await loadScorecardRows(userId, scope));
  const matched = rows.map((r) => ({
    id: r.id,
    date: flightDateOf(r.date),
    contribution: r.durationMin,
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    matched,
    page
  );
  const total = matched.reduce((sum, m) => sum + m.contribution, 0);
  return {
    measure: {
      kind: "metric",
      key: "scorecardFlightTimeMinutes",
      aggregation: "sum",
      label: { key: "evidence.metric.scorecardFlightTimeMinutes" },
      unit: "minutes",
      value: total,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}
