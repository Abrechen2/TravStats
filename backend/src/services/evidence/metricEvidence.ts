import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import {
  resolveFlightCount,
  resolveFlightTimeMinutes,
  resolveDistanceKmTotal,
  resolveAirlineCount,
  resolveFlightsWithoutAirlineCount,
  resolveBusinessTotalCost,
  resolvePunctualitySampleSize,
} from "./metricEvidenceFlightCore";
import {
  resolveAirportsVisitedCount,
  resolveFlightCountriesVisitedCount,
  resolveContinentsVisitedCount,
} from "./metricEvidenceFlightGeo";
import {
  resolveYearFlightCount,
  resolveYearDistanceKm,
  resolveYearFlightTimeMinutes,
  resolveYearTotalCost,
  resolveYearUnpricedFlightCount,
} from "./metricEvidenceFlightYear";
import {
  resolveScorecardFlightCount,
  resolveScorecardDistanceKm,
  resolveScorecardFlightTimeMinutes,
} from "./metricEvidenceScorecard";

/**
 * `EvidenceResolver` for `kind: "metric"` (Task 7,
 * `.superpowers/sdd/2026-09-18-evidence-panel/task-7-brief.md`). One
 * dispatch table, keyed by the SAME `MeasureSpec` keys
 * `shared/evidenceMeasures.ts` registers — a key with no entry here answers
 * `null`, which the route turns into the same 404 an unregistered ranking
 * dimension gets (`services/evidence/index.ts`).
 *
 * Only `servedIn: 1` keys are wired: eighteen of
 * `evidenceMeasuresFlightCore.ts`'s own measures (every `sum`/`distinct` key
 * on that surface) plus none yet from `evidenceMeasuresFlightFun.ts`,
 * `evidenceMeasuresCrossDomain.ts` or `evidenceMeasuresDomains.ts` — see
 * task-7-report.md for the exact count served vs. outstanding.
 */
const METRIC_RESOLVERS: Record<
  string,
  (userId: string, scope: EvidenceScope, page: PagingParams) => Promise<EvidenceResponse>
> = {
  flightCount: resolveFlightCount,
  flightTimeMinutes: resolveFlightTimeMinutes,
  distanceKmTotal: resolveDistanceKmTotal,
  airlineCount: resolveAirlineCount,
  flightsWithoutAirlineCount: resolveFlightsWithoutAirlineCount,
  businessTotalCost: resolveBusinessTotalCost,
  punctualitySampleSize: resolvePunctualitySampleSize,
  airportsVisitedCount: resolveAirportsVisitedCount,
  flightCountriesVisitedCount: resolveFlightCountriesVisitedCount,
  continentsVisitedCount: resolveContinentsVisitedCount,
  yearFlightCount: resolveYearFlightCount,
  yearDistanceKm: resolveYearDistanceKm,
  yearFlightTimeMinutes: resolveYearFlightTimeMinutes,
  yearTotalCost: resolveYearTotalCost,
  yearUnpricedFlightCount: resolveYearUnpricedFlightCount,
  scorecardFlightCount: resolveScorecardFlightCount,
  scorecardDistanceKm: resolveScorecardDistanceKm,
  scorecardFlightTimeMinutes: resolveScorecardFlightTimeMinutes,
};

export async function resolveMetricEvidence(
  userId: string,
  key: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse | null> {
  const resolve = METRIC_RESOLVERS[key];
  if (!resolve) return null;
  return resolve(userId, scope, page);
}
