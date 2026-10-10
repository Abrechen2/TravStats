/**
 * Evidence measures — the flights BEHIND the flight tab's "most" figures
 * (forgejo#256): the records, the longest and shortest distance, and the
 * extremes of the fun, unique and airport sections.
 *
 * Release 1 serves `sum` and `distinct` only (owner, 2026-09-18), and the
 * figures these stand behind are extremes — a distance, a latitude, a date.
 * So none of these is the figure itself: each is the SET of flights the
 * figure was taken from, counted in flights (`sum`, 1 per flight), and the
 * tile opens it with no rendered value to compare. The extremum measures the
 * inventory names for the figures (`longestFlightDistanceKm`, …) stay
 * release 2.
 *
 * MIRRORED at `backend/src/shared/evidenceMeasuresFlightWitnesses.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const witnesses = (surface: string, calculator: string): MeasureSpec => ({
  aggregation: "sum",
  unit: "flights",
  scopes: ["allTime"],
  surface,
  calculator,
  servedIn: 1,
});

const RECORDS = "GET /stats/records (services/stats/records.ts travelRecordWitnesses)";
const FUN = "GET /stats/fun (utils/stats/funStats.ts analyseFunStats)";
const UNIQUE = "GET /stats/unique (utils/stats/uniqueStats.ts analyseUniqueStats)";

export const FLIGHT_WITNESS_MEASURES: Record<string, MeasureSpec> = {
  recordLongestFlight: witnesses("RecordsSection", RECORDS),
  recordShortestFlight: witnesses("RecordsSection", RECORDS),
  recordBusiestDay: witnesses("RecordsSection", RECORDS),
  recordLongestAloft: witnesses("RecordsSection", RECORDS),
  recordBiggestDelay: witnesses("RecordsSection", RECORDS),
  recordNorthernmost: witnesses("RecordsSection", RECORDS),
  recordLongestStreak: witnesses("RecordsSection", RECORDS),
  longestDistanceFlights: witnesses(
    "StatsDistanceSection",
    "great-circle over the countable flights' coordinates (the page's flightDistances fold)"
  ),
  shortestDistanceFlights: witnesses(
    "StatsDistanceSection",
    "great-circle over the countable flights' coordinates (the page's flightDistances fold)"
  ),
  loyaltyAirlineFlights: witnesses("StatsFunSection", FUN),
  busiestDayFlights: witnesses("StatsFunSection", FUN),
  milestoneYearFlights: witnesses("StatsFunSection", FUN),
  routeMasterFlights: witnesses("StatsFunSection", FUN),
  seasonFlights: witnesses("StatsUniqueSection", UNIQUE),
  highestAirportFlights: witnesses("StatsUniqueSection", UNIQUE),
  northernmostFlights: witnesses("StatsUniqueSection", UNIQUE),
  southernmostFlights: witnesses("StatsUniqueSection", UNIQUE),
  travelChainFlights: witnesses("StatsUniqueSection", UNIQUE),
  fastestRouteFlights: witnesses("StatsUniqueSection", UNIQUE),
  mostCountriesDayFlights: witnesses("StatsUniqueSection", UNIQUE),
  longestLayoverFlights: witnesses("StatsUniqueSection", UNIQUE),
  shortestLayoverFlights: witnesses("StatsUniqueSection", UNIQUE),
  longestDurationFlights: witnesses(
    "StatsFlightBreakdown",
    "durationMinutes, else flightDurationOf, over the countable flights (the page's flightDurations fold)"
  ),
  shortestDurationFlights: witnesses(
    "StatsFlightBreakdown",
    "durationMinutes, else flightDurationOf, over the countable flights (the page's flightDurations fold)"
  ),
  farthestFromHomeFlights: witnesses(
    "StatsAirportsSection",
    "GET /stats/airports (utils/stats/airportStats.ts farthestFromHomeOf)"
  ),
};
