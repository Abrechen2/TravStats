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
import {
  resolveTimeTravelFlightCount,
  resolveEquatorCrossingCount,
  resolveArcticFlightCount,
  resolveOceanCrossingCount,
  resolveHemisphereHopCount,
  resolveDateLineCrossingCount,
  resolveContinentsTouchedByFlightCount,
  resolveTropicsFlightCount,
  resolveEastwardFlightCount,
  resolveWestwardFlightCount,
  resolveSameDayFlightCount,
  resolveMidnightFlightCount,
  resolveInternationalFlightCount,
  resolveDomesticFlightCount,
  resolveRoundTripFlightCount,
} from "./metricEvidenceFlightUnique";
import {
  resolveTravelAccountHotelNights,
  resolveTravelAccountSeaNights,
  resolveTravelAccountAirNights,
  resolveTravelAccountHomeNights,
  resolveTravelAccountContestedNights,
  resolveTravelAccountFullyCoveredTripCount,
  resolveTravelAccountTripsWithDatesCount,
  resolveTravelAccountUncoveredDayCount,
  resolveTravelAccountJournalEntryCount,
} from "./metricEvidenceTravelAccount";
import {
  resolveCruiseCount,
  resolveCruiseDistanceKmTotal,
  resolveCruiseSeaDaysTotal,
  resolveCruiseTotalDays,
  resolveCruisePortsUniqueCount,
  resolveCruiseShipsUniqueCount,
  resolveCruiseLinesUniqueCount,
  resolveCruiseCountriesCount,
  resolveCruiseCompanionCount,
  resolveCruiseTotalSpend,
} from "./metricEvidenceCruise";
import {
  resolveLodgingStaysCount,
  resolveLodgingNightsTotal,
  resolveLodgingSpendTotal,
  resolveLodgingAwardNightsCount,
  resolveLodgingNightsAwayTotal,
  resolveLodgingOneNightStayCount,
  resolveLodgingPerfectStayCount,
  resolveLodgingsUniqueCount,
  resolveLodgingCountriesCount,
  resolveLodgingContinentsCount,
} from "./metricEvidenceLodging";
import {
  resolveCrossDomainEventCount,
  resolveCrossDomainCountryCount,
  resolveCrossDomainActiveDayCount,
} from "./metricEvidenceCrossDomain";

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
 * on that surface, Task 7), the twenty-two `sum`/`distinct` keys of
 * `evidenceMeasuresFlightFun.ts` (Task 7b-1) and all twelve `sum`/`distinct`
 * measures of `evidenceMeasuresCrossDomain.ts` (Task 7b-2), and the
 * twenty-six cruise, lodging and places measures of
 * `evidenceMeasuresDomains.ts` (Task 7b-3) — seventy-eight in all, which is
 * every `servedIn: 1` entry in the registry. See task-7-report.md,
 * task-7b-1-report.md, task-7b-2-report.md and task-7b-3-report.md for what
 * each family mirrors and which served keys are deliberately unwired.
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
  timeTravelFlightCount: resolveTimeTravelFlightCount,
  equatorCrossingCount: resolveEquatorCrossingCount,
  arcticFlightCount: resolveArcticFlightCount,
  oceanCrossingCount: resolveOceanCrossingCount,
  hemisphereHopCount: resolveHemisphereHopCount,
  dateLineCrossingCount: resolveDateLineCrossingCount,
  continentsTouchedByFlightCount: resolveContinentsTouchedByFlightCount,
  tropicsFlightCount: resolveTropicsFlightCount,
  eastwardFlightCount: resolveEastwardFlightCount,
  westwardFlightCount: resolveWestwardFlightCount,
  sameDayFlightCount: resolveSameDayFlightCount,
  midnightFlightCount: resolveMidnightFlightCount,
  internationalFlightCount: resolveInternationalFlightCount,
  domesticFlightCount: resolveDomesticFlightCount,
  roundTripFlightCount: resolveRoundTripFlightCount,
  travelAccountHotelNights: resolveTravelAccountHotelNights,
  travelAccountSeaNights: resolveTravelAccountSeaNights,
  travelAccountAirNights: resolveTravelAccountAirNights,
  travelAccountHomeNights: resolveTravelAccountHomeNights,
  travelAccountContestedNights: resolveTravelAccountContestedNights,
  travelAccountFullyCoveredTripCount: resolveTravelAccountFullyCoveredTripCount,
  travelAccountTripsWithDatesCount: resolveTravelAccountTripsWithDatesCount,
  travelAccountUncoveredDayCount: resolveTravelAccountUncoveredDayCount,
  travelAccountJournalEntryCount: resolveTravelAccountJournalEntryCount,
  crossDomainEventCount: resolveCrossDomainEventCount,
  crossDomainCountryCount: resolveCrossDomainCountryCount,
  crossDomainActiveDayCount: resolveCrossDomainActiveDayCount,
  cruiseCount: resolveCruiseCount,
  cruiseDistanceKmTotal: resolveCruiseDistanceKmTotal,
  cruiseSeaDaysTotal: resolveCruiseSeaDaysTotal,
  cruiseTotalDays: resolveCruiseTotalDays,
  cruisePortsUniqueCount: resolveCruisePortsUniqueCount,
  cruiseShipsUniqueCount: resolveCruiseShipsUniqueCount,
  cruiseLinesUniqueCount: resolveCruiseLinesUniqueCount,
  cruiseCountriesCount: resolveCruiseCountriesCount,
  cruiseCompanionCount: resolveCruiseCompanionCount,
  cruiseTotalSpend: resolveCruiseTotalSpend,
  lodgingStaysCount: resolveLodgingStaysCount,
  lodgingNightsTotal: resolveLodgingNightsTotal,
  lodgingSpendTotal: resolveLodgingSpendTotal,
  lodgingAwardNightsCount: resolveLodgingAwardNightsCount,
  lodgingNightsAwayTotal: resolveLodgingNightsAwayTotal,
  lodgingOneNightStayCount: resolveLodgingOneNightStayCount,
  lodgingPerfectStayCount: resolveLodgingPerfectStayCount,
  lodgingsUniqueCount: resolveLodgingsUniqueCount,
  lodgingCountriesCount: resolveLodgingCountriesCount,
  lodgingContinentsCount: resolveLodgingContinentsCount,
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
