import { calculateDistance } from '../geo';
import { getCachedAirports } from '../../services/airportCache';
import { normalizeAirline } from '../airlineNormalize';
import logger from '../logger';
import type { FlightData, FunStats } from './types';

/**
 * Calculate fun/entertaining statistics.
 *
 * Selective filtering — historical flights have unreliable times (often a
 * 12:00 placeholder) so we split the input set:
 *   - `flownFlights`     : `flown` only with both times set. Used for
 *                          time-of-day buckets (earlyBird/afternoon/nightOwl)
 *                          and weekend warrior — they need precise local
 *                          hour/weekday.
 *   - `countableFlights` : `flown` + `historical`. Used for everything that
 *                          is time-insensitive: timezone hopper (airport
 *                          codes), loyalty score and most-used airline,
 *                          short/long haul (great-circle distance), fastest
 *                          day (calendar date), CO2, milestone year, and
 *                          route master.
 */
export async function calculateFunStats(flights: FlightData[]): Promise<FunStats> {
  // Time-sensitive subset — both times must be present. Historical entries
  // typically have placeholder times so we exclude them here.
  const flownFlights = flights.filter(
    (f): f is typeof f & { departureTime: Date; arrivalTime: Date } =>
      f.status === 'flown' && f.departureTime !== null && f.arrivalTime !== null
  );

  // Time-insensitive subset — flown + historical contribute to airport
  // count, distance, loyalty, etc.
  const countableFlights = flights.filter(
    (f) => f.status === 'flown' || f.status === 'historical'
  );

  // Timezone hopper — count unique timezones across every airport touched
  // (time-insensitive: only needs the airport metadata).
  const timezones = new Set<string>();
  const airportCodes = new Set<string>();

  for (const flight of countableFlights) {
    if (flight.depIata) airportCodes.add(flight.depIata);
    if (flight.depIcao) airportCodes.add(flight.depIcao);
    if (flight.arrIata) airportCodes.add(flight.arrIata);
    if (flight.arrIcao) airportCodes.add(flight.arrIcao);
  }

  try {
    const airports = await getCachedAirports(Array.from(airportCodes));
    for (const airport of airports.values()) {
      if (airport?.timezone) {
        timezones.add(airport.timezone);
      }
    }
  } catch (error) {
    logger.error({ operation: 'calculate_fun_stats', message: 'Failed to fetch airports for timezone calculation', error });
  }

  // Early bird vs night owl — needs precise local hour, flown-only.
  const morningFlights = flownFlights.filter(f => {
    const hour = new Date(f.departureTime).getHours();
    return hour >= 6 && hour < 12;
  }).length;

  const afternoonFlights = flownFlights.filter(f => {
    const hour = new Date(f.departureTime).getHours();
    return hour >= 12 && hour < 18;
  }).length;

  const eveningFlights = flownFlights.filter(f => {
    const hour = new Date(f.departureTime).getHours();
    return hour >= 18 || hour < 6;
  }).length;

  // Weekend warrior — needs precise local weekday, flown-only.
  const weekendFlights = flownFlights.filter(f => {
    const day = new Date(f.departureTime).getDay();
    return day === 0 || day === 6;
  }).length;

  // Loyalty score — percentage with most used airline (normalized names).
  // Time-insensitive — historical flights count toward airline preference.
  const airlineCounts: Record<string, number> = {};
  countableFlights.forEach(f => {
    if (f.airline) {
      const canonical = normalizeAirline(f.airline);
      airlineCounts[canonical] = (airlineCounts[canonical] || 0) + 1;
    }
  });

  const maxAirlineCount = Math.max(0, ...Object.values(airlineCounts));
  const loyaltyScore = countableFlights.length > 0
    ? Math.round((maxAirlineCount / countableFlights.length) * 100)
    : 0;

  // Short haul king — flights under 500km (distance, time-insensitive).
  const shortHaulFlights = countableFlights.filter(f => {
    if (f.depLat == null || f.depLon == null || f.arrLat == null || f.arrLon == null) return false;
    const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    return dist < 500;
  }).length;

  // Long haul pilot — flights over 5000km (distance, time-insensitive).
  const longHaulFlights = countableFlights.filter(f => {
    if (f.depLat == null || f.depLon == null || f.arrLat == null || f.arrLon == null) return false;
    const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    return dist >= 5000;
  }).length;

  // Fastest day — day with most flights. Calendar-date grouping is reliable
  // for historical too (the date is what the user remembers).
  const flightsByDate: Record<string, number> = {};
  countableFlights.forEach(f => {
    if (!f.departureTime) return;
    const dateKey = new Date(f.departureTime).toISOString().split('T')[0];
    flightsByDate[dateKey] = (flightsByDate[dateKey] || 0) + 1;
  });

  const maxFlightsOnDay = Math.max(0, ...Object.values(flightsByDate));
  const fastestDay = Object.entries(flightsByDate).find(([, count]) => count === maxFlightsOnDay)?.[0];

  // CO2 footprint in elephants (rough estimate: 1kg CO2 per km, elephant = 4000kg).
  // Distance-based, time-insensitive.
  let totalCO2kg = 0;
  countableFlights.forEach(f => {
    if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null) {
      const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
      // Rough estimate: 0.25kg CO2 per passenger per km for short haul, 0.2kg for long haul
      const co2PerKm = dist < 1500 ? 0.25 : 0.2;
      totalCO2kg += dist * co2PerKm;
    }
  });
  const elephants = totalCO2kg / 4000;

  // Milestone years — years with most flights. Year is reliable for
  // historical flights too.
  const flightsByYear: Record<number, number> = {};
  countableFlights.forEach(f => {
    if (!f.departureTime) return;
    const year = new Date(f.departureTime).getFullYear();
    flightsByYear[year] = (flightsByYear[year] || 0) + 1;
  });

  const topYear = Object.entries(flightsByYear)
    .sort(([, a], [, b]) => b - a)[0];

  // Route master — most frequent route. Airport-pair, time-insensitive.
  const routeCounts: Record<string, number> = {};
  countableFlights.forEach(f => {
    const route = `${f.depIata || f.depIcao || '?'}-${f.arrIata || f.arrIcao || '?'}`;
    routeCounts[route] = (routeCounts[route] || 0) + 1;
  });

  const topRoute = Object.entries(routeCounts)
    .sort(([, a], [, b]) => b - a)[0];

  return {
    timezoneHopper: timezones.size,
    earlyBird: morningFlights,
    afternoon: afternoonFlights,
    nightOwl: eveningFlights,
    weekendWarrior: weekendFlights,
    weekendPercentage: flownFlights.length > 0
      ? Math.round((weekendFlights / flownFlights.length) * 100)
      : 0,
    loyaltyScore,
    mostUsedAirline: Object.entries(airlineCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || null,
    shortHaulKing: shortHaulFlights,
    longHaulPilot: longHaulFlights,
    fastestDay: fastestDay || null,
    fastestDayFlights: maxFlightsOnDay,
    co2FootprintKg: Math.round(totalCO2kg),
    co2InElephants: Math.round(elephants * 10) / 10,
    milestoneYear: topYear ? parseInt(topYear[0]) : null,
    milestoneYearFlights: topYear ? topYear[1] : 0,
    routeMaster: topRoute ? topRoute[0] : null,
    routeMasterCount: topRoute ? topRoute[1] : 0,
  };
}
