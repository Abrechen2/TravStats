// Achievement dispatch + per-type helpers. Extracted from `achievements.ts`
// so the orchestrator module stays under CLAUDE.md's 800-line limit.

import type { Achievement } from '@prisma/client';
import { calculateDistance } from './geo';
import type { FlightData, UserStats } from './achievementStats';

export function checkAchievement(
  achievement: Achievement,
  stats: UserStats,
  flights: FlightData[]
): { isUnlocked: boolean; progress: number } {
  let progress = 0;
  let isUnlocked = false;

  switch (achievement.requirementType) {
    case 'flights_count':
      progress = stats.flightsCount;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'distance_km':
      progress = Math.round(stats.totalDistance);
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'countries':
      progress = stats.countries.size;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'airlines':
      progress = stats.airlines.size;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'airports':
      progress = stats.airports.size;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'continents':
      progress = stats.continents.size;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'aircraft_types':
      progress = stats.aircraftTypes.size;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'single_flight_distance':
      progress = Math.round(stats.longestSingleFlight);
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'night_flights':
      progress = stats.nightFlights;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'weekend_flights':
      progress = stats.weekendFlights;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'consecutive_months':
      progress = checkConsecutiveMonths(stats.monthsWithFlights);
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'same_route':
      progress = Math.max(0, ...Array.from(stats.routeCounts.values()));
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'airline_loyalty':
      progress = Math.max(0, ...Array.from(stats.airlineCounts.values()));
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'flights_per_month':
      progress = Math.max(0, ...Array.from(stats.flightsByMonth.values()));
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'flights_per_year':
      progress = Math.max(0, ...Array.from(stats.flightsByYear.values()));
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'flight_hours':
      progress = Math.round(stats.totalFlightHours);
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'ocean_crossing':
      progress = checkOceanCrossing(flights) ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'time_travel':
      progress = checkTimeTravel(flights) ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'arctic_flight':
      progress = checkArcticFlight(flights) ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'equator_crossing':
      progress = checkEquatorCrossing(flights) ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'all_seasons':
      progress = checkAllSeasons(flights);
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'scheduled_count':
      progress = stats.scheduledCount;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'scheduled_continents':
      progress = stats.scheduledContinents.size;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'scheduled_advance_days':
      progress = stats.scheduledMaxAdvanceDays;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cancelled_count':
      progress = stats.cancelledCount;
      isUnlocked = progress >= achievement.requirement;
      break;

    // v1.1 expansion
    case 'duplicated_count':
      progress = stats.duplicatedCount;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'island_flights':
      progress = stats.islandFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'micro_states_visited':
      progress = stats.microStatesVisited.size;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'scandinavia_set':
      progress = stats.scandinaviaSet.size;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'high_altitude_airports':
      progress = stats.highAltitudeFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'pilgrim_airports':
      progress = stats.pilgrimFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'micro_flight':
      progress = stats.hasMicroFlight;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'wide_body_count':
      progress = stats.wideBodyCount;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'turbo_prop_count':
      progress = stats.turboPropCount;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'airline_alliances':
      progress = stats.airlineAlliances.size;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'jumbo_count':
      progress = stats.jumboCount;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'airport_alphabet':
      progress = stats.airportAlphabet.size;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'lowcost_count':
      progress = stats.lowcostCount;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'first_class_flights':
      progress = stats.firstClassFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'premium_trifecta':
      progress = stats.premiumTrifecta.size;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'red_eye_flights':
      progress = stats.redEyeFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'early_morning_flights':
      progress = stats.earlyMorningFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'window_streak':
      progress = stats.windowStreak;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'middle_streak':
      progress = stats.middleStreak;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'notes_count':
      progress = stats.notesCount;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'groundhog_route':
      progress = stats.groundhogRoute;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'scheduled_30d':
      progress = stats.scheduled30d;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'delayed_flights':
      progress = stats.delayedFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'tight_connection':
      progress = stats.tightConnection;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'birthday_flights':
      progress = stats.birthdayFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'nye_airborne':
      progress = stats.nyeAirborne;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'leap_day_flights':
      progress = stats.leapDayFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'icao_day_flights':
      progress = stats.icaoDayFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'wright_day_flights':
      progress = stats.wrightDayFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'may_fourth_flights':
      progress = stats.mayFourthFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'pi_day_flights':
      progress = stats.piDayFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'pi_precision_flights':
      progress = stats.piPrecisionFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'halloween_flights':
      progress = stats.halloweenFlights;
      isUnlocked = progress >= achievement.requirement;
      break;

    // ── Kurios expansion (2.7) ────────────────────────────────────
    case 'friday13_flights':
      progress = stats.friday13Flights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'xmas_flights':
      progress = stats.xmasFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'palindrome_day_flights':
      progress = stats.palindromeFlights;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'flights_one_day_max':
      progress = stats.maxFlightsOneDay;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'same_day_return':
      progress = stats.hasSameDayReturn;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'flight_number_666':
      progress = stats.flight666Count;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'flight_number_777_on_777':
      progress = stats.jackpot777Count;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'timezone_span':
      progress = stats.maxTimezoneSpan;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'aisle_streak':
      progress = stats.aisleStreak;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'antarctic_flight':
      progress = checkAntarcticFlight(flights) ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    // --- Cruise cases ---
    case 'cruises_count':
      progress = stats.cruisesCount;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_ports_unique':
      progress = stats.cruisePortsUnique;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_ports_single':
      progress = stats.cruisePortsSingleMax;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_ships_unique':
      progress = stats.cruiseShipsUnique;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_lines_unique':
      progress = stats.cruiseLinesUnique;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_line_loyalty':
      progress = stats.cruiseLineLoyaltyMax;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'sea_days':
      progress = stats.seaDays;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'sea_days_streak':
      progress = stats.seaDaysStreak;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_region_mediterranean':
      progress = stats.cruiseRegions.has('mediterranean') ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_region_caribbean':
      progress = stats.cruiseRegions.has('caribbean') ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_region_baltic_or_fjords':
      progress =
        stats.cruiseRegions.has('baltic') || stats.cruiseRegions.has('norwegian_fjords')
          ? 1
          : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_canal_transit':
      progress = stats.hasCanalTransit ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_polar':
      progress = stats.hasPolar ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_distance_km':
      // Sum of great-circle distances between consecutive port calls
      // across all cruises (km). Approximation that ignores at-sea
      // routing detours but is close enough for milestone unlocks.
      progress = Math.floor(stats.cruiseTotalDistanceKm);
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_longest_leg_km':
      // Longest single leg across any cruise. Off-chart navigator hits
      // when the user has at least one true open-water crossing.
      progress = Math.floor(stats.cruiseLongestLegKm);
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_dateline_crossing':
      progress = stats.hasCruiseDatelineCrossing ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_equator_crossing':
      progress = stats.hasCruiseEquatorCrossing ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_ship_loyalty':
      progress = stats.cruiseShipLoyaltyMax;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_cabin_inside_count':
      progress = stats.cruiseInsideCabinCount;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'fly_and_sail_7d':
      progress = stats.hasFlyAndSail7d ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_cabin_balcony':
      progress = stats.hasBalconyCabin ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_cabin_suite':
      progress = stats.hasSuiteCabin ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_deck_min':
      progress = stats.cruiseMaxDeck;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_birthday_at_sea':
      progress = stats.hasCruiseBirthdayAtSea ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_new_years_at_sea':
      progress = stats.hasNewYearsAtSea ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'cruise_cold_water':
      progress = stats.hasColdWater ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'carnival_brands_all': {
      const CARNIVAL_BRANDS = new Set([
        'Carnival Cruise Line',
        'Costa Cruises',
        'AIDA Cruises',
        'Princess Cruises',
        'Holland America Line',
        'Cunard',
        'Seabourn',
        'P&O Cruises',
      ]);
      let covered = 0;
      for (const brand of CARNIVAL_BRANDS) {
        if (stats.cruiseLines.has(brand)) covered += 1;
      }
      progress = covered;
      isUnlocked = covered === CARNIVAL_BRANDS.size;
      break;
    }

    case 'fly_and_sail_trip':
      progress = stats.hasFlyAndSailTrip ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    // ── Sonder-Flüge ──────────────────────────────────────────────
    case 'special_sightseeing_count':
      progress = stats.specialSightseeingCount;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'special_zerog_count':
      progress = stats.specialZerogCount;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'special_eclipse_count':
      progress = stats.specialEclipseCount;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'special_rocket_count':
      progress = stats.specialRocketCount;
      isUnlocked = progress >= achievement.requirement;
      break;
    case 'special_variety':
      progress = stats.specialVariety;
      isUnlocked = progress >= achievement.requirement;
      break;

    // --- Lodging cases ---
    case 'lodgings_count':
      progress = stats.lodgingsCount;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_stays_count':
      progress = stats.lodgingStaysCount;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_nights':
      progress = stats.lodgingNights;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_chains_unique':
      progress = stats.lodgingChainsUnique;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_countries':
      progress = stats.lodgingCountries.size;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_chain_loyalty':
      progress = stats.lodgingChainLoyaltyMax;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_award_nights':
      progress = stats.lodgingAwardNights;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_same_hotel_repeat':
      progress = stats.lodgingSameHotelRepeatMax;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_longest_stay':
      progress = stats.lodgingLongestStayNights;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_types_unique':
      progress = stats.lodgingTypesUnique;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_cities_unique':
      progress = stats.lodgingCitiesUnique;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_continents':
      progress = stats.lodgingContinents;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_five_star_nights':
      progress = stats.lodgingFiveStarNights;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_all_inclusive_nights':
      progress = stats.lodgingAllInclusiveNights;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_perfect_stays':
      progress = stats.lodgingPerfectStays;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_endured_stays':
      progress = stats.lodgingEnduredStays;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_rated_stays':
      progress = stats.lodgingRatedStays;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_one_night_stays':
      progress = stats.lodgingOneNightStays;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_streak_nights':
      progress = stats.lodgingStreakNights;
      isUnlocked = progress >= achievement.requirement;
      break;

    // Requirement is a PERCENTAGE (e.g. 25 = a quarter of the year away).
    case 'lodging_away_share_pct':
      progress = stats.lodgingAwaySharePct;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_independent_nights':
      progress = stats.lodgingIndependentNights;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_programme_year_nights':
      progress = stats.lodgingProgrammeYearNights;
      isUnlocked = progress >= achievement.requirement;
      break;

    // Requirement is a latitude in whole degrees (66 = the Arctic Circle).
    case 'lodging_northern_lat':
      progress = Math.floor(stats.lodgingNorthernmostLat);
      isUnlocked = progress >= achievement.requirement;
      break;

    // Requirement is a SOUTHERN latitude in whole degrees (45 = 45°S).
    // The stat stores the raw (negative) latitude; flip the sign so a
    // northern-hemisphere-only traveller clamps to 0, never unlocks.
    case 'lodging_southern_lat':
      progress = Math.max(0, Math.floor(-stats.lodgingSouthernmostLat));
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_birthday_stay':
      progress = stats.hasLodgingBirthdayStay ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'lodging_xmas_stay':
      progress = stats.hasLodgingXmasStay ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'trips_fully_documented':
      progress = stats.tripsFullyDocumented;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'fly_and_stay':
      progress = stats.flyAndStay ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    case 'grand_tour':
      progress = stats.grandTour ? 1 : 0;
      isUnlocked = progress >= achievement.requirement;
      break;

    default:
      progress = 0;
      isUnlocked = false;
  }

  return { isUnlocked, progress };
}

function checkConsecutiveMonths(monthsWithFlights: Set<string>): number {
  if (monthsWithFlights.size === 0) return 0;

  const sortedMonths = Array.from(monthsWithFlights).sort();
  let maxConsecutive = 1;
  let currentConsecutive = 1;

  for (let i = 1; i < sortedMonths.length; i++) {
    const prevDate = new Date(sortedMonths[i - 1] + '-01');
    const currDate = new Date(sortedMonths[i] + '-01');

    // Check if next month
    const monthDiff =
      (currDate.getFullYear() - prevDate.getFullYear()) * 12 +
      (currDate.getMonth() - prevDate.getMonth());

    if (monthDiff === 1) {
      currentConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    } else {
      currentConsecutive = 1;
    }
  }

  return maxConsecutive;
}

function checkOceanCrossing(flights: FlightData[]): boolean {
  for (const flight of flights) {
    const distance = calculateDistance(
      flight.depLat,
      flight.depLon,
      flight.arrLat,
      flight.arrLon
    );
    // Simple heuristic: flights over 5000km likely cross an ocean
    if (distance > 5000) {
      return true;
    }
  }
  return false;
}

function checkTimeTravel(flights: FlightData[]): boolean {
  for (const flight of flights) {
    // Arrive before departure (in UTC) — skip historical flights with null times
    if (flight.arrivalTime && flight.departureTime && flight.arrivalTime < flight.departureTime) {
      return true;
    }
  }
  return false;
}

function checkArcticFlight(flights: FlightData[]): boolean {
  const arcticCircle = 66.5;
  for (const flight of flights) {
    if (flight.depLat >= arcticCircle || flight.arrLat >= arcticCircle) {
      return true;
    }
  }
  return false;
}

function checkAntarcticFlight(flights: FlightData[]): boolean {
  const antarcticCircle = -66.5;
  for (const flight of flights) {
    if (flight.depLat <= antarcticCircle || flight.arrLat <= antarcticCircle) {
      return true;
    }
  }
  return false;
}

function checkEquatorCrossing(flights: FlightData[]): boolean {
  for (const flight of flights) {
    // Check if flight crosses equator (one hemisphere to another)
    if (
      (flight.depLat > 0 && flight.arrLat < 0) ||
      (flight.depLat < 0 && flight.arrLat > 0)
    ) {
      return true;
    }
  }
  return false;
}

function checkAllSeasons(flights: FlightData[]): number {
  // Northern hemisphere seasons
  const seasons = new Set<number>();
  for (const flight of flights) {
    if (!flight.departureTime) continue;
    const month = flight.departureTime.getMonth(); // 0-11
    if (month >= 2 && month <= 4) seasons.add(0); // Spring (Mar-May)
    if (month >= 5 && month <= 7) seasons.add(1); // Summer (Jun-Aug)
    if (month >= 8 && month <= 10) seasons.add(2); // Fall (Sep-Nov)
    if (month === 11 || month === 0 || month === 1) seasons.add(3); // Winter (Dec-Feb)
  }
  return seasons.size;
}
