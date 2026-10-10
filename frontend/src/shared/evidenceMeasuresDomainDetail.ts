/**
 * Evidence measures — the POPULATIONS behind the cruise tab's rhythm and fun
 * tiles and the lodging tab's money, loyalty, quality and geography tiles
 * (forgejo#257/#258).
 *
 * Those tiles show averages, shares, a median and extremes. Release 1 serves
 * `sum` and `distinct` only (owner, 2026-09-18), so instead of an
 * `extremum` or `ratio` measure each tile opens the set its figure is read
 * from, every entry naming what it brings (nights, a price per night, a chain,
 * four ratings, a position). See the two resolver files for why the panel
 * cannot name an entry the figure did not read.
 *
 * MIRRORED at `backend/src/shared/evidenceMeasuresDomainDetail.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const CRUISE_LIST_CALCULATOR =
  "lib/stats/cruiseStatsDetail.ts deriveCruiseStats over cruiseApi.list() (shared/cruiseRowFacts.ts); services/evidence/metricEvidenceCruiseDetail.ts";
const LODGING_DETAIL_CALCULATOR =
  "GET /stats/lodging (utils/lodgingStats money/quality/geography/loyalty); services/evidence/metricEvidenceLodgingDetail.ts";

const cruiseList = (unit: string, surface: string): MeasureSpec => ({
  aggregation: "sum",
  unit,
  scopes: ["allTime", "year"],
  surface,
  calculator: CRUISE_LIST_CALCULATOR,
  servedIn: 1,
});

const cruiseRollup = (unit: string): MeasureSpec => ({
  aggregation: "sum",
  unit,
  scopes: ["allTime", "year"],
  surface: "CruiseStatsSection",
  calculator:
    "GET /stats/cruise (utils/cruiseStats.ts calculateCruiseStats, per cruise); services/evidence/metricEvidenceCruiseDepth.ts",
  servedIn: 1,
});

const lodgingDetail = (unit: string, surface: string): MeasureSpec => ({
  aggregation: "sum",
  unit,
  scopes: ["allTime", "year"],
  surface,
  calculator: LODGING_DETAIL_CALCULATOR,
  servedIn: 1,
});

export const DOMAIN_DETAIL_MEASURES: Record<string, MeasureSpec> = {
  // ── Cruise tab, rhythm and fun (CruiseDetailSections) ──
  /** Busiest month, first cruise, the two calendar charts. Booked and cancelled cruises included, as on the list. */
  cruiseDatedCount: cruiseList(
    "cruises",
    "CruiseStatsSection (CruiseRhythmSection, CruiseFunSection)"
  ),
  /** Average, longest and shortest cruise: nights per cruise with both dates. */
  cruiseNightsTotal: cruiseList("nights", "CruiseStatsSection (CruiseRhythmSection)"),
  /** Most port calls on one cruise: the calls each itinerary lists, sea days excluded. */
  cruiseListedPortCallsTotal: cruiseList("ports", "CruiseStatsSection (CruiseFunSection)"),
  cruiseDeckRecordedCount: cruiseList("cruises", "CruiseStatsSection (CruiseFunSection)"),
  cruiseOnTripCount: cruiseList("cruises", "CruiseStatsSection (CruiseFunSection)"),

  // ── Cruise tab, key figures that are a ratio, an extreme or a streak (CruiseStatsSection) ──
  /** Ports per cruise: every call of the effective itinerary, unrecognised ones included. */
  cruisePortCallsTotal: cruiseRollup("ports"),
  /** Most catalogued ports on one cruise, and the revisit rate's calls. */
  cruiseCataloguePortCallsTotal: cruiseRollup("ports"),
  cruiseRiverCount: cruiseRollup("cruises"),
  /** The deepest deck: sailed cruises with a deck recorded. */
  cruiseSailedDeckCount: cruiseRollup("cruises"),

  // ── Lodging tab (LodgingMoneySection, LodgingLoyaltySection, LodgingQualitySection, LodgingGeoSection) ──
  /** Average, median, cheapest and dearest night: stays with a comparable price, by nights. */
  lodgingPricedNightsTotal: lodgingDetail("nights", "LodgingStatsSection (LodgingMoneySection)"),
  /** The paid rate the award nights are valued at — award stays excluded. */
  lodgingPaidNightsTotal: lodgingDetail("nights", "LodgingStatsSection (LodgingMoneySection)"),
  /** Chain share, top-chain share and concentration. */
  lodgingChainNightsTotal: lodgingDetail("nights", "LodgingStatsSection (LodgingLoyaltySection)"),
  lodgingTopChainNights: lodgingDetail("nights", "LodgingStatsSection (LodgingLoyaltySection)"),
  /** The four rating averages: stays with any rating, each naming all four. */
  lodgingRatedStaysCount: lodgingDetail("stays", "LodgingStatsSection (LodgingQualitySection)"),
  /** Northernmost, southernmost, centre of gravity. */
  lodgingLocatedStaysCount: lodgingDetail("stays", "LodgingStatsSection (LodgingGeoSection)"),
};
