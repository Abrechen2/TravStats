/**
 * Evidence measures — cruise, lodging and places tabs. See
 * `evidenceMeasures.ts` for what this file is part of and why it is split
 * out.
 *
 * SCOPES, corrected in task 7b-3: every entry here used to list `year` alone,
 * and every one of these tiles renders with no year selected — the period
 * strip's default on all three tabs is lifetime (`scope.year === null`), which
 * is the state `CruiseStatsSection`, `LodgingStatsSection` and
 * `PoiStatsSection` fall back to. A registry that named only `year` said the
 * tile could not show the number it shows by default, and a resolver bound to
 * it would have answered 400 for the panel's most common request.
 *
 * MIRRORED at `backend/src/shared/evidenceMeasuresDomains.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const CRUISE_CALCULATOR = "GET /stats/cruise?year= (utils/cruiseStats.ts calculateCruiseStats)";
const CRUISE_DETAIL_CALCULATOR = "lib/stats/cruiseStatsDetail.ts deriveCruiseStats (client fold)";
// The endpoint is `/stats/lodging`, not `/lodging/stats`: the handler lives
// in `routes/stats.ts` and the client calls it there. Corrected in task 7b-3;
// the path named before was one no route ever answered.
const LODGING_CALCULATOR =
  "GET /stats/lodging?year= (utils/lodgingStats/index.ts calculateLodgingStats)";
const CRUISE_SPEND_CALCULATOR =
  "Cruise.price_base summed in the account's base currency (services/trip/tripCostSuperlative.ts's rule)";
const POI_CALCULATOR = "lib/stats/poiStatsDetail.ts derivePoiStats (client fold over listPlaces)";

export const DOMAIN_MEASURES: Record<string, MeasureSpec> = {
  // ── Cruise tab (CruiseStatsSection) ──
  cruiseCount: {
    aggregation: "sum",
    unit: "cruises",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 1,
  },
  cruiseDistanceKmTotal: {
    aggregation: "sum",
    unit: "km",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 1,
  },
  cruiseSeaDaysTotal: {
    aggregation: "sum",
    unit: "days",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 1,
  },
  cruisePortsUniqueCount: {
    aggregation: "distinct",
    unit: "ports",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 1,
  },
  cruiseShipsUniqueCount: {
    aggregation: "distinct",
    unit: "ships",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 1,
  },
  cruiseLinesUniqueCount: {
    aggregation: "distinct",
    unit: "lines",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 1,
  },
  cruiseTotalDays: {
    aggregation: "sum",
    unit: "days",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 1,
  },
  cruiseCountriesCount: {
    aggregation: "distinct",
    unit: "countries",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 1,
  },
  cruiseAvgPortsPerCruise: {
    aggregation: "ratio",
    unit: "ports/cruise",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 2,
  },
  cruiseLongestLegKm: {
    aggregation: "extremum",
    unit: "km",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 2,
  },
  cruisePortsSingleTripMax: {
    aggregation: "extremum",
    unit: "ports",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 2,
  },
  cruiseLineLoyaltyMax: {
    aggregation: "extremum",
    unit: "cruises",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 2,
  },
  cruiseSeaDaysStreak: {
    aggregation: "sequence",
    unit: "days",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 2,
  },
  cruiseMaxDeck: {
    aggregation: "extremum",
    unit: "deck",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 2,
  },
  cruisePortRevisitRate: {
    aggregation: "ratio",
    unit: "%",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 2,
  },
  cruiseFlagAchieved: {
    aggregation: "boolean",
    unit: "boolean",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection",
    calculator: CRUISE_CALCULATOR,
    servedIn: 2,
  },
  cruiseCompanionCount: {
    aggregation: "sum",
    unit: "companions",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection (CruiseFunSection)",
    calculator: CRUISE_DETAIL_CALCULATOR,
    servedIn: 1,
  },
  cruiseTotalSpend: {
    aggregation: "sum",
    unit: "currency",
    scopes: ["allTime", "year"],
    surface: "CruiseStatsSection (CruiseMoneySection)",
    // NOT the client fold, corrected in task 7b-3: `deriveCruiseStats`
    // deliberately produces no single total — it reports each currency on its
    // own line and says so on screen. What makes one honest is the FX snapshot
    // `Cruise` gained in Task 10, and the rule for reading it is
    // `services/trip/tripCostSuperlative.ts`, one domain narrower.
    calculator: CRUISE_SPEND_CALCULATOR,
    servedIn: 1,
  },

  // ── Lodging tab (LodgingStatsSection) ──
  lodgingStaysCount: {
    aggregation: "sum",
    unit: "stays",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection",
    calculator: LODGING_CALCULATOR,
    servedIn: 1,
  },
  lodgingNightsTotal: {
    aggregation: "sum",
    unit: "nights",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection",
    calculator: LODGING_CALCULATOR,
    servedIn: 1,
  },
  lodgingsUniqueCount: {
    aggregation: "distinct",
    unit: "lodgings",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection",
    calculator: LODGING_CALCULATOR,
    servedIn: 1,
  },
  lodgingCountriesCount: {
    aggregation: "distinct",
    unit: "countries",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection",
    calculator: LODGING_CALCULATOR,
    servedIn: 1,
  },
  lodgingSpendTotal: {
    aggregation: "sum",
    unit: "currency",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection (LodgingCurrencyBreakdown)",
    calculator: LODGING_CALCULATOR,
    servedIn: 1,
  },
  lodgingAvgCostPerNight: {
    aggregation: "ratio",
    unit: "currency/night",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection (LodgingMoneySection)",
    calculator: LODGING_CALCULATOR,
    servedIn: 2,
  },
  lodgingAwardNightsCount: {
    aggregation: "sum",
    unit: "nights",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection (LodgingMoneySection)",
    calculator: LODGING_CALCULATOR,
    servedIn: 1,
  },
  lodgingAvgOverallRating: {
    aggregation: "ratio",
    unit: "stars",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection (LodgingQualitySection)",
    calculator: LODGING_CALCULATOR,
    servedIn: 2,
  },
  lodgingContinentsCount: {
    aggregation: "distinct",
    unit: "continents",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection (LodgingGeoSection)",
    calculator: LODGING_CALCULATOR,
    servedIn: 1,
  },
  lodgingNightsAwayTotal: {
    // `distinct`, not `sum`, corrected in task 7b-3: `computeRhythmStats`
    // answers this with the SIZE of the set of dates the user was away, so two
    // stays that overlap contribute fewer nights than they hold. A sum would
    // be `walkableNights`, which the same module reports separately precisely
    // so the difference can be shown as the double booking it is.
    aggregation: "distinct",
    unit: "nights",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection (LodgingRhythmSection)",
    calculator: LODGING_CALCULATOR,
    servedIn: 1,
  },
  lodgingTopChainShare: {
    aggregation: "ratio",
    unit: "%",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection (LodgingLoyaltySection)",
    calculator: LODGING_CALCULATOR,
    servedIn: 2,
  },
  lodgingLongestStayNights: {
    aggregation: "extremum",
    unit: "nights",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection (LodgingRecordsSection)",
    calculator: LODGING_CALCULATOR,
    servedIn: 2,
  },
  lodgingOneNightStayCount: {
    aggregation: "sum",
    unit: "stays",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection (LodgingRecordsSection)",
    calculator: LODGING_CALCULATOR,
    servedIn: 1,
  },
  lodgingPerfectStayCount: {
    aggregation: "sum",
    unit: "stays",
    scopes: ["allTime", "year"],
    surface: "LodgingStatsSection (LodgingRecordsSection)",
    calculator: LODGING_CALCULATOR,
    servedIn: 1,
  },

  // ── Places tab (PoiStatsSection) ──
  placesVisitedCount: {
    aggregation: "distinct",
    unit: "places",
    scopes: ["allTime", "year"],
    surface: "PoiStatsSection",
    calculator: POI_CALCULATOR,
    servedIn: 1,
  },
  placeVisitCount: {
    aggregation: "sum",
    unit: "visits",
    scopes: ["allTime", "year"],
    surface: "PoiStatsSection",
    calculator: POI_CALCULATOR,
    servedIn: 1,
  },
  placeCountriesCount: {
    aggregation: "distinct",
    unit: "countries",
    scopes: ["allTime", "year"],
    surface: "PoiStatsSection",
    calculator: POI_CALCULATOR,
    servedIn: 1,
  },
  placeCitiesCount: {
    aggregation: "distinct",
    unit: "cities",
    scopes: ["allTime", "year"],
    surface: "PoiStatsSection",
    calculator: POI_CALCULATOR,
    servedIn: 1,
  },
  placeListCount: {
    aggregation: "sum",
    unit: "lists",
    scopes: ["allTime"],
    surface: "PoiStatsSection",
    calculator: "listPlaceLists/listCuratedChecklists (client fold, no year scope)",
    servedIn: 1,
  },
  placeWishlistCount: {
    aggregation: "sum",
    unit: "places",
    scopes: ["allTime"],
    surface: "PoiStatsSection",
    calculator: POI_CALCULATOR,
    servedIn: 1,
  },
  placeVisitStreakLength: {
    aggregation: "sequence",
    unit: "days",
    scopes: ["allTime", "year"],
    surface: "PoiStatsSection (PoiRhythmSection)",
    calculator: POI_CALCULATOR,
    servedIn: 2,
  },
  placeCategoryCoveragePct: {
    aggregation: "ratio",
    unit: "%",
    scopes: ["allTime", "year"],
    surface: "PoiStatsSection (PoiFunSection)",
    calculator: POI_CALCULATOR,
    servedIn: 2,
  },
  placeAvgRating: {
    aggregation: "ratio",
    unit: "stars",
    scopes: ["allTime", "year"],
    surface: "PoiStatsSection (PoiQualitySection)",
    calculator: POI_CALCULATOR,
    servedIn: 2,
  },
};
