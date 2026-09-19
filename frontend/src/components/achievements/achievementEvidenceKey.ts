import { EVIDENCE_MEASURES } from "../../shared/evidenceMeasures";

/**
 * Which achievement rules stand on a statistic the evidence panel can list.
 *
 * #330's public comment promised "for every statistic behind it, the entries
 * that produced the number". The achievement kind itself does not answer yet
 * — `GET /evidence?kind=achievement` is a 501 held for release 2 (owner,
 * 2026-09-18), which the beta audit of 2026-09-19 measured on the live beta.
 * But a great many rules do not need it: "Absolviere 10 Flüge" counts exactly
 * the flights `flightCount` already lists, and that key IS served. This table
 * is the join, so those dialogs can offer the entries today instead of
 * waiting for a kind that answers nothing.
 *
 * The key is the rule's `requirementType` (`backend/src/data/achievementSeeds/*`),
 * not the achievement code — seven codes share `flights_count`, and it is the
 * RULE, not the badge, that names the statistic.
 *
 * Two conditions an entry must meet, both load-bearing:
 *
 * 1. **The measure is really served.** `EvidenceTrigger` says it plainly: a
 *    tile may use it only where a resolver exists, and wiring one on a
 *    registry claim alone "ships a pointer cursor over a 404, which is GitHub
 *    #330 with an extra round trip". `servedIn: 1` and the backend's
 *    `servedMetricKeys()` agree exactly today (78 = 78, held by
 *    `backend/src/services/evidence/__tests__/registryBinding.test.ts`), so
 *    the test below checks this table against `servedIn: 1`.
 * 2. **The numbers are the SAME number, in the same unit.** The rule's
 *    `progress` is passed to the panel as `renderedValue` and compared against
 *    the freshly measured figure, so a near-miss is worse than no entry at
 *    all. That is why `flight_hours` is absent although `flightTimeMinutes`
 *    is served (hours against minutes), and why the boolean rules
 *    (`ocean_crossing`, which is 0 or 1) are absent although the matching
 *    counters are served.
 *
 * A rule that is not here renders an honest sentence in the dialog instead of
 * a trigger. Adding one is a two-line change once its measure is served.
 */
export const ACHIEVEMENT_EVIDENCE_KEY: Record<string, string> = {
  // Flights — `utils/achievementChecks.ts` reads the same counters the
  // corresponding resolvers do.
  flights_count: "flightCount",
  distance_km: "distanceKmTotal",
  airlines: "airlineCount",
  airports: "airportsVisitedCount",
  continents: "continentsVisitedCount",
  // `countries` is ABSENT, and that is the second condition above doing its
  // job. The rule folds each airport's country through `toCountryCode` and
  // drops the catalogue's placeholder codes ("ZZ", "XZ" -- they name no
  // country); `resolveFlightCountriesVisitedCount` counts the catalogue's raw
  // `country` strings. The two therefore disagree on any account whose
  // catalogue carries a placeholder or two spellings of one country, and the
  // panel would report that disagreement as "the figure has since been
  // recomputed" -- an alarm about nothing, on the reader's own screen
  // (review, 2026-09-19). Mapping it needs the two to be reconciled first,
  // which is a change to the RESOLVER and not a line in this table.

  // Cruises
  cruises_count: "cruiseCount",
  cruise_distance_km: "cruiseDistanceKmTotal",
  cruise_ports_unique: "cruisePortsUniqueCount",
  cruise_ships_unique: "cruiseShipsUniqueCount",
  cruise_lines_unique: "cruiseLinesUniqueCount",
  sea_days: "cruiseSeaDaysTotal",

  // Lodging
  lodgings_count: "lodgingsUniqueCount",
  lodging_stays_count: "lodgingStaysCount",
  lodging_nights: "lodgingNightsTotal",
  lodging_countries: "lodgingCountriesCount",
  lodging_continents: "lodgingContinentsCount",
  lodging_award_nights: "lodgingAwardNightsCount",
  lodging_one_night_stays: "lodgingOneNightStayCount",
  lodging_perfect_stays: "lodgingPerfectStayCount",

  // Places
  places_count: "placesVisitedCount",
  place_visits_count: "placeVisitCount",
  place_countries: "placeCountriesCount",
  place_cities: "placeCitiesCount",
};

/** The served measure behind this rule, or null when nobody can list it yet. */
export function evidenceKeyForRule(requirementType: string): string | null {
  const key = ACHIEVEMENT_EVIDENCE_KEY[requirementType];
  if (!key) return null;
  // Belt and braces for a measure that is later demoted to release 2: the
  // dialog then falls back to the honest sentence rather than a dead trigger.
  return EVIDENCE_MEASURES[key]?.servedIn === 1 ? key : null;
}
