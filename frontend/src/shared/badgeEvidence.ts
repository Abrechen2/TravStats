/**
 * Which list of entries stands behind every badge rule (forgejo#265,
 * acceptance: "Auszeichnungen nennen Bedingung, Fortschritt und Belege").
 *
 * Three answers, and every rule type in the seeds has exactly one of them —
 * `backend/src/services/evidence/badges/__tests__/badgeEvidenceCoverage.test.ts`
 * fails for a rule type that has none:
 *
 * 1. `BADGE_MEASURE_KEYS` — the rule counts exactly what a statistics measure
 *    already lists, in the same unit, so the badge opens that measure.
 * 2. `BADGE_PROOF_TYPES` — the badge opens its own proof
 *    (`services/evidence/badges/`): the entries its progress stands on, found
 *    by asking the badge's own measure over subsets of its rows.
 * 3. `BADGE_WITHOUT_EVIDENCE` — no list exists, with the reason why.
 *
 * MIRRORED at `backend/src/shared/badgeEvidence.ts`.
 */

/**
 * Rules that count exactly what a served measure lists. The rule's
 * `progress` is handed to the panel as the rendered value and compared with
 * the fresh figure, so only the SAME number in the SAME unit qualifies —
 * which is why `flight_hours` (hours) is not mapped to `flightTimeMinutes`
 * and `countries` not to the flight country count: those open their proof.
 */
export const BADGE_MEASURE_KEYS: Record<string, string> = {
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

  // Day tours (forgejo#264) — the badge reads the same completed-tour count
  // the tour tab folds (`services/stats/insights`). The climb is absent: the
  // badge floors metres, the panel rounds them, and a one-metre difference
  // would read as "recomputed".
  tour_count: "tourCompletedCount",

  // Rail (2.7) — the badges and these measures fold the same rides through
  // `utils/railAchievements.ts`, so progress and panel are one number.
  // `rail_longest_km` is absent: the longest ride is an extremum, which
  // release 1 does not serve; the rail tab names that ride as its record.
  rail_count: "railRideCount",
  rail_km: "railDistanceKmTotal",
  rail_countries: "railCountriesCount",
  rail_operators: "railOperatorsCount",
  rail_night_trains: "railNightTrainCount",
  rail_high_speed: "railHighSpeedRideCount",
  rail_cross_border: "railCrossBorderRideCount",
  // forgejo#261: the journeys behind "Gut umgestiegen", counted by the same
  // fold. The station return and the year with the most new connections are
  // extrema — release 1 serves neither, so their dialogs say so.
  rail_documented_transfer_journeys: "railDocumentedTransferJourneyCount",

  // Rental and bus (forgejo#262, #263) — the badge folds and these measures
  // read the same rows (`utils/rentalAchievements.ts`, `services/bus/busStats.ts`),
  // so a badge's progress and its list are one number (forgejo#265).
  rental_count: "rentalCount",
  rental_one_way: "rentalOneWayCount",
  rental_odometer_documented: "rentalOdometerDocumentedCount",
  bus_count: "busRideCount",
  bus_night_rides: "busNightRideCount",
  bus_terminals: "busTerminalsCount",
};

/** Rules whose badge opens its own proof — every seed rule not mapped above. */
export const BADGE_PROOF_TYPES: readonly string[] = [
  "aircraft_types",
  "airline_alliances",
  "airline_loyalty",
  "airport_alphabet",
  "aisle_streak",
  "all_seasons",
  "antarctic_flight",
  "arctic_flight",
  "birthday_flights",
  "cancelled_count",
  "carnival_brands_all",
  "consecutive_months",
  "countries",
  "cruise_birthday_at_sea",
  "cruise_cabin_balcony",
  "cruise_cabin_inside_count",
  "cruise_cabin_suite",
  "cruise_canal_transit",
  "cruise_cold_water",
  "cruise_dateline_crossing",
  "cruise_deck_min",
  "cruise_equator_crossing",
  "cruise_excursion_ports",
  "cruise_line_loyalty",
  "cruise_longest_leg_km",
  "cruise_new_years_at_sea",
  "cruise_polar",
  "cruise_port_cruises",
  "cruise_ports_single",
  "cruise_region_baltic_or_fjords",
  "cruise_region_caribbean",
  "cruise_region_mediterranean",
  "cruise_repeated_itinerary",
  "cruise_ship_loyalty",
  "curated_list_ticked:museum-warships",
  "curated_list_ticked:world-heritage",
  "curated_list_ticked:world-wonders-ancient",
  "curated_list_ticked:world-wonders-new7",
  "delayed_flights",
  "duplicated_count",
  "early_morning_flights",
  "equator_crossing",
  "first_class_flights",
  "flight_airport_all_quarters",
  "flight_airport_reunion_years",
  "flight_hours",
  "flight_new_airports_year",
  "flight_number_666",
  "flight_number_777_on_777",
  "flights_one_day_max",
  "flights_per_month",
  "flights_per_year",
  "fly_and_sail_7d",
  "fly_and_sail_trip",
  "fly_and_stay",
  "friday13_flights",
  "grand_tour",
  "groundhog_route",
  "halloween_flights",
  "high_altitude_airports",
  "icao_day_flights",
  "island_flights",
  "jumbo_count",
  "leap_day_flights",
  "lodging_all_inclusive_nights",
  "lodging_away_share_pct",
  "lodging_birthday_stay",
  "lodging_chain_loyalty",
  "lodging_chains_unique",
  "lodging_cities_unique",
  "lodging_endured_stays",
  "lodging_five_star_nights",
  "lodging_independent_nights",
  "lodging_longest_stay",
  "lodging_months_in_year",
  "lodging_northern_lat",
  "lodging_programme_year_nights",
  "lodging_rated_stays",
  "lodging_same_hotel_repeat",
  "lodging_same_house_years",
  "lodging_southern_lat",
  "lodging_streak_nights",
  "lodging_trip_types_max",
  "lodging_types_unique",
  "lodging_xmas_stay",
  "lowcost_count",
  "may_fourth_flights",
  "micro_flight",
  "micro_states_visited",
  "middle_streak",
  "night_flights",
  "notes_count",
  "nye_airborne",
  "ocean_crossing",
  "palindrome_day_flights",
  "pi_day_flights",
  "pi_precision_flights",
  "pilgrim_airports",
  "place_categories_unique",
  "place_continents",
  "place_countries_in_year",
  "place_documented_visits",
  "place_northern_lat",
  "place_rated_visits",
  "place_revisit_gap_years",
  "place_same_repeat",
  "place_southern_lat",
  "place_trip_categories_max",
  "place_trip_visits",
  "place_visit_streak",
  "place_visits_in_year",
  "places_in_category",
  "places_one_day",
  "premium_trifecta",
  "rail_longest_km",
  "rail_new_connections_year",
  "rail_station_return_years",
  "red_eye_flights",
  "roadtrip_base_camp",
  "roadtrip_count",
  "roadtrip_countries_single",
  "roadtrip_free_nights",
  "roadtrip_km",
  "roadtrip_land_and_water",
  "roadtrip_longest_km",
  "roadtrip_tour_stations",
  "same_day_return",
  "same_route",
  "scandinavia_set",
  "scheduled_30d",
  "scheduled_advance_days",
  "scheduled_continents",
  "scheduled_count",
  "sea_days_streak",
  "single_flight_distance",
  "special_eclipse_count",
  "special_rocket_count",
  "special_sightseeing_count",
  "special_variety",
  "special_zerog_count",
  "tight_connection",
  "time_travel",
  "timezone_span",
  "tour_activities_unique",
  "tour_ascent_m",
  "trips_arrive_and_discover",
  "trips_fully_documented",
  "trips_three_modes",
  "turbo_prop_count",
  "weekend_flights",
  "wide_body_count",
  "window_streak",
  "wright_day_flights",
  "xmas_flights",
];

/** Rules with no list of entries, each with the reason. None today. */
export const BADGE_WITHOUT_EVIDENCE: Readonly<Record<string, string>> = {};

/**
 * The evidence key of a rule's proof: `badge` + the rule in PascalCase —
 * `night_flights` → `badgeNightFlights`,
 * `curated_list_ticked:world-heritage` → `badgeCuratedListTickedWorldHeritage`.
 */
export function badgeProofKey(requirementType: string): string {
  return (
    "badge" +
    requirementType
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join("")
  );
}

/** The evidence key behind a rule, or null when it has none. */
export function badgeEvidenceKey(requirementType: string): string | null {
  const measure = BADGE_MEASURE_KEYS[requirementType];
  if (measure) return measure;
  return BADGE_PROOF_TYPES.includes(requirementType) ? badgeProofKey(requirementType) : null;
}
