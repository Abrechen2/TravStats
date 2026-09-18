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
import {
  resolveTimezoneHopperFlightCount,
  resolveEarlyBirdFlightCount,
  resolveNightOwlFlightCount,
  resolveWeekendFlightCount,
  resolveShortHaulFlightCount,
  resolveLongHaulFlightCount,
  resolveCo2FootprintKg,
} from "./metricEvidenceFlightFun";

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
 * on that surface, Task 7) plus the seven `sum`/`distinct` keys of
 * `evidenceMeasuresFlightFun.ts`'s fun half (Task 7b-1) — twenty-five in
 * all, with that file's fifteen unique keys following. Nothing yet
 * from `evidenceMeasuresCrossDomain.ts` or `evidenceMeasuresDomains.ts`; see
 * task-7-report.md and task-7b-1-report.md for served vs. outstanding.
 */
type MetricResolver = (
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
) => Promise<EvidenceResponse>;

const METRIC_RESOLVERS: Record<string, MetricResolver> = {
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
  timezoneHopperFlightCount: resolveTimezoneHopperFlightCount,
  earlyBirdFlightCount: resolveEarlyBirdFlightCount,
  nightOwlFlightCount: resolveNightOwlFlightCount,
  weekendFlightCount: resolveWeekendFlightCount,
  shortHaulFlightCount: resolveShortHaulFlightCount,
  longHaulFlightCount: resolveLongHaulFlightCount,
  co2FootprintKg: resolveCo2FootprintKg,
};

/**
 * The keys this instance actually answers. Exported for
 * `__tests__/registryBinding.test.ts`, which is the only thing tying
 * `shared/evidenceMeasures.ts` to running code: the registry is imported by
 * nothing else, so `servedIn: 1` was a claim no machine checked — 78 entries
 * asserted it while 18 had a resolver. The test reads this list rather than
 * a hand-kept copy, because a hand-kept copy of a served-key list is the
 * same defect one level down.
 */
export function servedMetricKeys(): string[] {
  return Object.keys(METRIC_RESOLVERS);
}

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
