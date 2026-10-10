import type { Achievement } from "../../../prisma";
import { checkAchievement } from "../../../utils/achievementChecks";
import { computeCoreStats, type CoreDeps, type CoreInputs } from "../../../utils/achievementInputs";
import type { FlightData } from "../../../utils/achievementStats";
import { flightDateOf } from "../entryMappers";
import {
  cruiseEvidenceEntry,
  placeEvidenceEntry,
  stayEvidenceEntry,
  tripEvidenceEntry,
} from "../entryMappersDomains";
import type { FlightTimeSemantics } from "../../../utils/timezone";
import type { EvidenceEntry } from "../../../schemas/evidence";
import type { BadgeFamily, BadgeRule } from "./badgeFamily";

/**
 * The badges `checkAchievement` answers (flights, the planner badges, cruises,
 * stays, places and the trip flags), measured by `computeCoreStats` — the very
 * fold the badge check runs — over a subset of ONE kind of row, or two.
 */
export type CoreArray = "flights" | "allFlights" | "cruises" | "lodgingStays" | "places" | "trips";

const FLIGHT_RULES = [
  "flights_count",
  "distance_km",
  "airlines",
  "airports",
  "aircraft_types",
  "single_flight_distance",
  "night_flights",
  "weekend_flights",
  "consecutive_months",
  "same_route",
  "airline_loyalty",
  "flights_per_month",
  "flights_per_year",
  "flight_hours",
  "ocean_crossing",
  "time_travel",
  "arctic_flight",
  "antarctic_flight",
  "equator_crossing",
  "all_seasons",
  "island_flights",
  "micro_states_visited",
  "scandinavia_set",
  "high_altitude_airports",
  "pilgrim_airports",
  "micro_flight",
  "wide_body_count",
  "turbo_prop_count",
  "airline_alliances",
  "jumbo_count",
  "airport_alphabet",
  "lowcost_count",
  "first_class_flights",
  "premium_trifecta",
  "red_eye_flights",
  "early_morning_flights",
  "window_streak",
  "middle_streak",
  "notes_count",
  "groundhog_route",
  "delayed_flights",
  "tight_connection",
  "birthday_flights",
  "nye_airborne",
  "leap_day_flights",
  "icao_day_flights",
  "wright_day_flights",
  "may_fourth_flights",
  "pi_day_flights",
  "pi_precision_flights",
  "halloween_flights",
  "friday13_flights",
  "xmas_flights",
  "palindrome_day_flights",
  "flights_one_day_max",
  "same_day_return",
  "flight_number_666",
  "flight_number_777_on_777",
  "timezone_span",
  "aisle_streak",
  "special_sightseeing_count",
  "special_zerog_count",
  "special_eclipse_count",
  "special_rocket_count",
  "special_variety",
];

/** Planning and survivor badges read EVERY flight, booked and cancelled ones included. */
const PLANNER_RULES = [
  "scheduled_count",
  "scheduled_continents",
  "scheduled_advance_days",
  "scheduled_30d",
  "cancelled_count",
  "duplicated_count",
];

const CRUISE_RULES = [
  "cruises_count",
  "cruise_ports_unique",
  "cruise_ports_single",
  "cruise_ships_unique",
  "cruise_lines_unique",
  "cruise_line_loyalty",
  "sea_days",
  "sea_days_streak",
  "cruise_region_mediterranean",
  "cruise_region_caribbean",
  "cruise_region_baltic_or_fjords",
  "cruise_canal_transit",
  "cruise_polar",
  "cruise_distance_km",
  "cruise_longest_leg_km",
  "cruise_dateline_crossing",
  "cruise_equator_crossing",
  "cruise_ship_loyalty",
  "cruise_cabin_inside_count",
  "cruise_cabin_balcony",
  "cruise_cabin_suite",
  "cruise_deck_min",
  "cruise_birthday_at_sea",
  "cruise_new_years_at_sea",
  "cruise_cold_water",
  "carnival_brands_all",
  // The cruise's own trip carries the flights it is checked against.
  "fly_and_sail_trip",
];

const LODGING_RULES = [
  "lodgings_count",
  "lodging_stays_count",
  "lodging_nights",
  "lodging_chains_unique",
  "lodging_countries",
  "lodging_chain_loyalty",
  "lodging_award_nights",
  "lodging_same_hotel_repeat",
  "lodging_longest_stay",
  "lodging_types_unique",
  "lodging_cities_unique",
  "lodging_continents",
  "lodging_five_star_nights",
  "lodging_all_inclusive_nights",
  "lodging_perfect_stays",
  "lodging_endured_stays",
  "lodging_rated_stays",
  "lodging_one_night_stays",
  "lodging_streak_nights",
  "lodging_away_share_pct",
  "lodging_independent_nights",
  "lodging_programme_year_nights",
  "lodging_northern_lat",
  "lodging_southern_lat",
  "lodging_birthday_stay",
  "lodging_xmas_stay",
];

const PLACE_RULES = [
  "places_count",
  "place_visits_count",
  "place_countries",
  "places_in_category",
  "place_cities",
  "place_continents",
  "place_categories_unique",
  "place_same_repeat",
  "places_one_day",
  "place_visit_streak",
  "place_visits_in_year",
  "place_countries_in_year",
  "place_rated_visits",
  "place_trip_visits",
  "place_northern_lat",
  "place_southern_lat",
];

/** Which rows each core badge is measured over. */
export function coreArraysFor(requirementType: string): CoreArray[] | null {
  if (requirementType.startsWith("curated_list_ticked:")) return ["places"];
  if (FLIGHT_RULES.includes(requirementType)) return ["flights"];
  if (PLANNER_RULES.includes(requirementType)) return ["allFlights"];
  if (CRUISE_RULES.includes(requirementType)) return ["cruises"];
  if (LODGING_RULES.includes(requirementType)) return ["lodgingStays"];
  if (PLACE_RULES.includes(requirementType)) return ["places"];
  // Continents join airports and ports; the ±7-day badge a flight and a cruise.
  if (requirementType === "continents" || requirementType === "fly_and_sail_7d") {
    return ["flights", "cruises"];
  }
  if (requirementType === "fly_and_stay" || requirementType === "grand_tour") return ["trips"];
  return null;
}

/** Every requirement type the core families answer — the guard test reads it. */
export const CORE_REQUIREMENT_TYPES: readonly string[] = [
  ...FLIGHT_RULES,
  ...PLANNER_RULES,
  ...CRUISE_RULES,
  ...LODGING_RULES,
  ...PLACE_RULES,
  "continents",
  "fly_and_sail_7d",
  "fly_and_stay",
  "grand_tour",
];

type Row = { [K in CoreArray]: { array: K; row: CoreInputs[K][number] } }[CoreArray];

const EMPTY: Pick<CoreInputs, CoreArray> = {
  flights: [],
  allFlights: [],
  cruises: [],
  lodgingStays: [],
  places: [],
  trips: [],
};

type FlightRow = CoreInputs["flights"][number];

function flightEntry(f: FlightRow): Omit<EvidenceEntry, "contribution"> {
  return {
    domain: "flight",
    id: f.id,
    href: `/flights/${f.id}`,
    title: { text: f.flightNumber ?? "—" },
    subtitle: { text: `${f.depIata ?? f.depIcao ?? "?"} → ${f.arrIata ?? f.arrIcao ?? "?"}` },
    date: flightDateOf({
      departureTime: f.departureTime,
      depTimezone: f.depTimezone,
      depTimeSemantics: f.depTimeSemantics as FlightTimeSemantics,
    }),
  };
}

function entryOf(r: Row): Omit<EvidenceEntry, "contribution"> {
  switch (r.array) {
    case "flights":
    case "allFlights":
      return flightEntry(r.row);
    case "cruises": {
      const c = r.row;
      // The route or the ship as the traveller named them — data, not copy.
      const label = c.routeName ?? c.shipNameOverride ?? c.cruiseLine ?? "—";
      return cruiseEvidenceEntry({ id: c.id, label, startDate: c.startDate }, { subtitle: null });
    }
    case "lodgingStays": {
      const s = r.row;
      return stayEvidenceEntry(
        { id: s.id, lodgingId: s.lodgingId, lodgingName: s.lodging.name, checkIn: s.checkIn },
        { subtitle: null }
      );
    }
    case "places": {
      const p = r.row;
      const first = p.visits
        .map((v) => v.visitedAt)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      return placeEvidenceEntry(
        { id: p.id, placeId: p.id, placeName: p.name, visitedAt: first ?? null },
        { subtitle: null }
      );
    }
    case "trips": {
      const t = r.row;
      return tripEvidenceEntry(
        { id: t.id, name: t.name, startDate: t.startDate },
        { subtitle: null }
      );
    }
  }
}

/**
 * The core family of one badge. Rows of kinds the badge does not read are
 * left out of each fold, so a probe costs what its own rows cost — unless
 * that changes the badge's number (a measure that reads further context),
 * in which case every other row is kept, exactly as the badge check sees it.
 */
export async function coreFamily(
  rule: BadgeRule,
  arrays: CoreArray[],
  inputs: CoreInputs,
  deps: CoreDeps
): Promise<BadgeFamily<Row>> {
  const rows: Row[] = arrays.flatMap((array) =>
    (inputs[array] as Array<Row["row"]>).map((row) => ({ array, row }) as Row)
  );
  const measure = async (subset: readonly Row[], context: Partial<CoreInputs>): Promise<number> => {
    const picked = Object.fromEntries(
      arrays.map((array) => [array, subset.filter((r) => r.array === array).map((r) => r.row)])
    );
    const folded: CoreInputs = { ...inputs, ...context, ...picked };
    const { stats } = await computeCoreStats(folded, deps);
    return checkAchievement(rule as Achievement, stats, folded.flights as FlightData[]).progress;
  };
  const lean = await measure(rows, EMPTY);
  const full = await measure(rows, {});
  const context = lean === full ? EMPTY : {};
  return { rows, entryOf, progress: (subset) => measure(subset, context) };
}
