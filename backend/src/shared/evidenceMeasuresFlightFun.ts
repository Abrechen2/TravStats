/**
 * Evidence measures — flight tab, part 2: fun statistics (StatsFunSection)
 * and unique statistics (StatsUniqueSection). See `evidenceMeasures.ts` for
 * what this file is part of and why it is split out.
 *
 * MIRRORED at `frontend/src/shared/evidenceMeasuresFlightFun.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const FUN_CALCULATOR = "GET /stats/fun (utils/stats/funStats.ts calculateFunStats)";
const UNIQUE_CALCULATOR = "GET /stats/unique (utils/stats/uniqueStats.ts calculateUniqueStats)";

export const FLIGHT_FUN_MEASURES: Record<string, MeasureSpec> = {
  // ── Fun statistics ──
  /**
   * A DISTINCT count of TIMEZONES, not of flights. `calculateFunStats`
   * answers this tile with `timezones.size` — the union of the IANA zones of
   * every airport the countable set touches — so the `sum` / `flights` this
   * entry carried until 2026-09-19 described neither the aggregation nor the
   * unit of the number on screen. Corrected while serving it (task 7b-1),
   * against the calculator this entry itself names. The KEY keeps its
   * misleading name on purpose: a key is an address, and renaming one breaks
   * every `?evidence=` link already in the wild for a wording fix.
   */
  timezoneHopperFlightCount: {
    aggregation: "distinct",
    unit: "timezones",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 1,
  },
  earlyBirdFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 1,
  },
  nightOwlFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 1,
  },
  weekendFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 1,
  },
  weekendFlightSharePct: {
    aggregation: "ratio",
    unit: "%",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 2,
  },
  loyaltyScorePct: {
    aggregation: "ratio",
    unit: "%",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 2,
  },
  shortHaulFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 1,
  },
  longHaulFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 1,
  },
  busiestFlightDayCount: {
    aggregation: "extremum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 2,
  },
  co2FootprintKg: {
    aggregation: "sum",
    unit: "kg",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 1,
  },
  co2FootprintElephantsRatio: {
    aggregation: "ratio",
    unit: "elephants",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 2,
  },
  milestoneYearFlightCount: {
    aggregation: "extremum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 2,
  },
  routeMasterFlightCount: {
    aggregation: "extremum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsFunSection",
    calculator: FUN_CALCULATOR,
    servedIn: 2,
  },

  // ── Unique statistics ──
  timeTravelFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  equatorCrossingCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  arcticFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  oceanCrossingCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  hemisphereHopCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  dateLineCrossingCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  continentsTouchedByFlightCount: {
    aggregation: "distinct",
    unit: "continents",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  tropicsFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  eastwardFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  westwardFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  eastWestBalanceRatio: {
    aggregation: "ratio",
    unit: "ratio",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 2,
  },
  sameDayFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  midnightFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  seasonalExplorerAchieved: {
    aggregation: "boolean",
    unit: "boolean",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 2,
  },
  internationalFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  domesticFlightCount: {
    aggregation: "sum",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  internationalDomesticRatio: {
    aggregation: "ratio",
    unit: "ratio",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 2,
  },
  /**
   * The unit is ROUND TRIPS, not flights: `calculateUniqueStats` counts
   * `min(there, back)` per unordered airport pair, so two legs make one of
   * them and a `flights` unit overstated the tile by a factor of two.
   * Corrected while serving it (task 7b-1); each leg of a pair contributes
   * 0.5, which is what makes the panel's rows add up to the tile.
   */
  roundTripFlightCount: {
    aggregation: "sum",
    unit: "roundTrips",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 1,
  },
  highestAirportAltitudeM: {
    aggregation: "extremum",
    unit: "m",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 2,
  },
  northernmostAirportLat: {
    aggregation: "extremum",
    unit: "degrees",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 2,
  },
  southernmostAirportLat: {
    aggregation: "extremum",
    unit: "degrees",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 2,
  },
  longestTravelChainLength: {
    aggregation: "sequence",
    unit: "flights",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 2,
  },
  fastestRouteSpeedKmh: {
    aggregation: "extremum",
    unit: "km/h",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 2,
  },
  mostCountriesInOneDayCount: {
    aggregation: "extremum",
    unit: "countries",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 2,
  },
  longestLayoverHours: {
    aggregation: "extremum",
    unit: "hours",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 2,
  },
  shortestLayoverHours: {
    aggregation: "extremum",
    unit: "hours",
    scopes: ["allTime"],
    surface: "StatsUniqueSection",
    calculator: UNIQUE_CALCULATOR,
    servedIn: 2,
  },
};
