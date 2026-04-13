import { calculateDistance } from '../geo';
import { getCachedAirports } from '../../services/airportCache';
import { tzAwareDurationMinutes } from '../timezone';
import logger from '../logger';
import type { AirportData } from '../../services/airportLookup';
import type { FlightData, UniqueStats } from './types';

/**
 * Calculate unique/special statistics
 */
export async function calculateUniqueStats(flights: FlightData[]): Promise<UniqueStats> {
  // Narrow to flown flights with known times (historical flights have null times)
  const flownFlights = flights.filter(
    (f): f is typeof f & { departureTime: Date; arrivalTime: Date } =>
      f.status === 'flown' && f.departureTime !== null && f.arrivalTime !== null
  );

  // Time travel index - flights where local arrival time (at destination) appears to be before
  // local departure time (at origin), e.g. departing NYC at 23:00 EST and arriving London at
  // 11:00 GMT — the clock "went back" by 5 hours so the local arrival hour is earlier.
  let timeTravelFlights = 0;

  // Collect all airport codes needed for timezone lookups; reused later for altitude etc.
  const airportCodes = new Set<string>();
  for (const f of flownFlights) {
    if (f.depIata) airportCodes.add(f.depIata);
    if (f.depIcao) airportCodes.add(f.depIcao);
    if (f.arrIata) airportCodes.add(f.arrIata);
    if (f.arrIcao) airportCodes.add(f.arrIcao);
  }

  // Build a timezone map from the cached airport data (code → IANA timezone string)
  const timezoneMap = new Map<string, string>();
  let airportsForTimezone: Map<string, AirportData> = new Map();
  try {
    airportsForTimezone = await getCachedAirports(Array.from(airportCodes));
    for (const [code, airport] of airportsForTimezone.entries()) {
      if (airport?.timezone) {
        timezoneMap.set(code, airport.timezone);
      }
    }
  } catch (error) {
    logger.error({
      operation: 'calculate_unique_stats',
      message: 'Failed to fetch airports for time-travel calculation',
      error,
    });
  }

  for (const f of flownFlights) {
    const depTz =
      (f.depIata && timezoneMap.get(f.depIata)) ||
      (f.depIcao && timezoneMap.get(f.depIcao)) ||
      null;
    const arrTz =
      (f.arrIata && timezoneMap.get(f.arrIata)) ||
      (f.arrIcao && timezoneMap.get(f.arrIcao)) ||
      null;

    if (!depTz || !arrTz) {
      // No timezone data available — skip rather than guess
      continue;
    }

    if (toLocalMinutes(f.arrivalTime, arrTz) < toLocalMinutes(f.departureTime, depTz)) {
      timeTravelFlights++;
    }
  }

  // Equator crossings
  let equatorCrossings = 0;
  flownFlights.forEach(f => {
    if (f.depLat != null && f.arrLat != null) {
      // Check if flight crosses equator (one hemisphere to another)
      if ((f.depLat > 0 && f.arrLat < 0) || (f.depLat < 0 && f.arrLat > 0)) {
        equatorCrossings++;
      }
    }
  });

  // Arctic circle flights (north of 66.5°)
  const arcticCircle = 66.5;
  const arcticFlights = flownFlights.filter(f => {
    return (f.depLat != null && f.depLat >= arcticCircle) ||
           (f.arrLat != null && f.arrLat >= arcticCircle);
  }).length;

  // Ocean crossings - simplified heuristic: flights over 5000km likely cross an ocean
  const oceanCrossings = flownFlights.filter(f => {
    if (f.depLat == null || f.depLon == null || f.arrLat == null || f.arrLon == null) return false;
    const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    return dist > 5000;
  }).length;

  // Highest airport (altitude) — reuse the airport data already fetched for timezone lookups
  let highestAirport: { code: string; name: string; altitude: number } | null = null;

  try {
    // If the timezone fetch above failed, do a fresh fetch; otherwise reuse cached data
    const airportsForAltitude = airportsForTimezone.size > 0
      ? airportsForTimezone
      : await getCachedAirports(Array.from(airportCodes));
    for (const [code, airport] of airportsForAltitude.entries()) {
      if (airport && airport.altitude != null) {
        if (!highestAirport || airport.altitude > highestAirport.altitude) {
          highestAirport = {
            code: code,
            name: airport.name || code,
            altitude: airport.altitude,
          };
        }
      }
    }
  } catch (error) {
    logger.error({ operation: 'calculate_unique_stats', message: 'Failed to fetch airports for altitude calculation', error });
  }

  // Northernmost and southernmost points
  let northernmost: { lat: number; code: string } | null = null;
  let southernmost: { lat: number; code: string } | null = null;

  flownFlights.forEach(f => {
    if (f.depLat != null) {
      if (!northernmost || f.depLat > northernmost.lat) {
        northernmost = { lat: f.depLat, code: f.depIata || f.depIcao || '?' };
      }
      if (!southernmost || f.depLat < southernmost.lat) {
        southernmost = { lat: f.depLat, code: f.depIata || f.depIcao || '?' };
      }
    }
    if (f.arrLat != null) {
      if (!northernmost || f.arrLat > northernmost.lat) {
        northernmost = { lat: f.arrLat, code: f.arrIata || f.arrIcao || '?' };
      }
      if (!southernmost || f.arrLat < southernmost.lat) {
        southernmost = { lat: f.arrLat, code: f.arrIata || f.arrIcao || '?' };
      }
    }
  });

  // Longest travel chain (consecutive flights)
  let longestChain = 0;
  if (flownFlights.length > 0) {
    const sortedFlights = [...flownFlights].sort((a, b) =>
      new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
    );

    let currentChain = 1;
    for (let i = 1; i < sortedFlights.length; i++) {
      const prev = sortedFlights[i - 1];
      const curr = sortedFlights[i];

      // Check if current flight departs from where previous arrived (within 24 hours)
      const prevArrCode = prev.arrIata || prev.arrIcao;
      const currDepCode = curr.depIata || curr.depIcao;
      const timeDiff = new Date(curr.departureTime).getTime() - new Date(prev.arrivalTime).getTime();
      const hoursDiff = timeDiff / (1000 * 60 * 60);

      if (prevArrCode && currDepCode && prevArrCode === currDepCode && hoursDiff >= 0 && hoursDiff <= 24) {
        currentChain++;
      } else {
        longestChain = Math.max(longestChain, currentChain);
        currentChain = 1;
      }
    }
    longestChain = Math.max(longestChain, currentChain);
  }

  // Fastest route (highest average ground speed) — timezone-aware duration
  let fastestRoute: { route: string; speed: number } | null = null;

  flownFlights.forEach(f => {
    if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null) {
      const distance = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);

      const depTz =
        (f.depIata && timezoneMap.get(f.depIata)) ||
        (f.depIcao && timezoneMap.get(f.depIcao)) ||
        null;
      const arrTz =
        (f.arrIata && timezoneMap.get(f.arrIata)) ||
        (f.arrIcao && timezoneMap.get(f.arrIcao)) ||
        null;

      const durationMinutes = tzAwareDurationMinutes(f.departureTime, f.arrivalTime, depTz, arrTz);
      const durationHours = durationMinutes / 60;

      if (durationHours > 0.5) { // Ignore flights with <30min duration (likely bad data)
        const speed = distance / durationHours; // km/h
        if (speed <= 1200 && (!fastestRoute || speed > fastestRoute.speed)) {
          fastestRoute = {
            route: `${f.depIata || f.depIcao || '?'}-${f.arrIata || f.arrIcao || '?'}`,
            speed: Math.round(speed),
          };
        }
      }
    }
  });

  // Most countries in one day
  const flightsByDate: Record<string, FlightData[]> = {};
  flownFlights.forEach(f => {
    const dateKey = new Date(f.departureTime).toISOString().split('T')[0];
    if (!flightsByDate[dateKey]) {
      flightsByDate[dateKey] = [];
    }
    flightsByDate[dateKey].push(f);
  });

  let mostCountriesInDay = 0;
  let mostCountriesDate: string | null = null;

  try {
    const airports = airportsForTimezone.size > 0
      ? airportsForTimezone
      : await getCachedAirports(Array.from(airportCodes));

    Object.entries(flightsByDate).forEach(([date, dayFlights]) => {
      const countries = new Set<string>();
      dayFlights.forEach(f => {
        const depCode = f.depIata || f.depIcao;
        const arrCode = f.arrIata || f.arrIcao;

        if (depCode) {
          const airport = airports.get(depCode);
          if (airport?.country) countries.add(airport.country);
        }
        if (arrCode) {
          const airport = airports.get(arrCode);
          if (airport?.country) countries.add(airport.country);
        }
      });

      if (countries.size > mostCountriesInDay) {
        mostCountriesInDay = countries.size;
        mostCountriesDate = date;
      }
    });
  } catch (error) {
    logger.error({ operation: 'calculate_unique_stats', message: 'Failed to fetch airports for country calculation', error });
  }

  // Hemisphere hopper - flights crossing between northern and southern hemisphere
  let hemisphereHops = 0;
  flownFlights.forEach(f => {
    if (f.depLat != null && f.arrLat != null) {
      // Check if flight crosses from one hemisphere to another
      if ((f.depLat > 0 && f.arrLat < 0) || (f.depLat < 0 && f.arrLat > 0)) {
        hemisphereHops++;
      }
    }
  });

  // Date line crosser - flights crossing the International Date Line (180° longitude)
  let dateLineCrossings = 0;
  flownFlights.forEach(f => {
    if (f.depLon != null && f.arrLon != null) {
      // Check if flight crosses the date line (180° or -180°)
      const lonDiff = Math.abs(f.arrLon - f.depLon);
      // If the difference is greater than 180°, the flight likely crossed the date line
      if (lonDiff > 180) {
        dateLineCrossings++;
      }
    }
  });

  // Continental explorer - count unique continents
  const continents = new Set<string>();
  try {
    const airports = airportsForTimezone.size > 0
      ? airportsForTimezone
      : await getCachedAirports(Array.from(airportCodes));
    flownFlights.forEach(f => {
      const depCode = f.depIata || f.depIcao;
      const arrCode = f.arrIata || f.arrIcao;

      if (depCode) {
        const airport = airports.get(depCode);
        if (airport) {
          const continent = getContinentFromCoordinates(airport.lat, airport.lon);
          if (continent) continents.add(continent);
        }
      }
      if (arrCode) {
        const airport = airports.get(arrCode);
        if (airport) {
          const continent = getContinentFromCoordinates(airport.lat, airport.lon);
          if (continent) continents.add(continent);
        }
      }
    });
  } catch (error) {
    logger.error({ operation: 'calculate_unique_stats', message: 'Failed to fetch airports for continent calculation', error });
  }

  // Tropics traveler - flights within the tropics (between 23.5°N and 23.5°S)
  const tropicOfCancer = 23.5;
  const tropicOfCapricorn = -23.5;
  const tropicsFlights = flownFlights.filter(f => {
    if (f.depLat == null || f.arrLat == null) return false;
    // Check if both departure and arrival are within tropics
    const depInTropics = f.depLat >= tropicOfCapricorn && f.depLat <= tropicOfCancer;
    const arrInTropics = f.arrLat >= tropicOfCapricorn && f.arrLat <= tropicOfCancer;
    return depInTropics || arrInTropics;
  }).length;

  // East-West balance - ratio of eastward vs westward flights
  let eastwardFlights = 0;
  let westwardFlights = 0;
  flownFlights.forEach(f => {
    if (f.depLon != null && f.arrLon != null) {
      let lonDiff = f.arrLon - f.depLon;
      // Handle date line crossing
      if (lonDiff > 180) lonDiff -= 360;
      if (lonDiff < -180) lonDiff += 360;

      if (lonDiff > 0) eastwardFlights++;
      else if (lonDiff < 0) westwardFlights++;
    }
  });

  // Same-day flights - flights that depart and arrive on the same local calendar day
  const sameDayFlights = flownFlights.filter(f => {
    const depTz =
      (f.depIata && timezoneMap.get(f.depIata)) ||
      (f.depIcao && timezoneMap.get(f.depIcao)) ||
      null;
    const arrTz =
      (f.arrIata && timezoneMap.get(f.arrIata)) ||
      (f.arrIcao && timezoneMap.get(f.arrIcao)) ||
      null;
    const depDate = toLocalDateString(f.departureTime, depTz);
    const arrDate = toLocalDateString(f.arrivalTime, arrTz);
    return depDate === arrDate;
  }).length;

  // Midnight flyer - flights that cross midnight (local time)
  const midnightFlights = flownFlights.filter(f => {
    const depTz =
      (f.depIata && timezoneMap.get(f.depIata)) ||
      (f.depIcao && timezoneMap.get(f.depIcao)) ||
      null;
    const arrTz =
      (f.arrIata && timezoneMap.get(f.arrIata)) ||
      (f.arrIcao && timezoneMap.get(f.arrIcao)) ||
      null;
    const depDate = toLocalDateString(f.departureTime, depTz);
    const arrDate = toLocalDateString(f.arrivalTime, arrTz);
    return depDate !== arrDate;
  }).length;

  // Seasonal explorer - flights in all 4 seasons
  const seasons = new Set<number>();
  flownFlights.forEach(f => {
    const month = new Date(f.departureTime).getMonth(); // 0-11
    // Northern hemisphere seasons
    if (month >= 2 && month <= 4) seasons.add(0); // Spring (Mar-May)
    if (month >= 5 && month <= 7) seasons.add(1); // Summer (Jun-Aug)
    if (month >= 8 && month <= 10) seasons.add(2); // Fall (Sep-Nov)
    if (month === 11 || month === 0 || month === 1) seasons.add(3); // Winter (Dec-Feb)
  });

  // International vs domestic - ratio based on countries
  let internationalFlights = 0;
  let domesticFlights = 0;
  try {
    const airports = airportsForTimezone.size > 0
      ? airportsForTimezone
      : await getCachedAirports(Array.from(airportCodes));
    flownFlights.forEach(f => {
      const depCode = f.depIata || f.depIcao;
      const arrCode = f.arrIata || f.arrIcao;

      if (depCode && arrCode) {
        const depAirport = airports.get(depCode);
        const arrAirport = airports.get(arrCode);

        if (depAirport?.country && arrAirport?.country) {
          if (depAirport.country === arrAirport.country) {
            domesticFlights++;
          } else {
            internationalFlights++;
          }
        }
      }
    });
  } catch (error) {
    logger.error({ operation: 'calculate_unique_stats', message: 'Failed to fetch airports for international/domestic calculation', error });
  }

  // Longest layover - longest time between consecutive flights
  let longestLayover: { hours: number; from: string; to: string } | null = null;
  if (flownFlights.length > 1) {
    const sortedFlights = [...flownFlights].sort((a, b) =>
      new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
    );

    for (let i = 0; i < sortedFlights.length - 1; i++) {
      const current = sortedFlights[i];
      const next = sortedFlights[i + 1];

      const currentArrCode = current.arrIata || current.arrIcao || '?';
      const nextDepCode = next.depIata || next.depIcao || '?';

      // Check if next flight departs from where current arrived
      if (currentArrCode === nextDepCode) {
        const layoverHours = (new Date(next.departureTime).getTime() - new Date(current.arrivalTime).getTime()) / (1000 * 60 * 60);

        if (layoverHours > 0 && (!longestLayover || layoverHours > longestLayover.hours)) {
          longestLayover = {
            hours: Math.round(layoverHours * 10) / 10,
            from: currentArrCode,
            to: nextDepCode,
          };
        }
      }
    }
  }

  // Round trip master - count complete round trips (A->B->A)
  const roundTrips = new Map<string, number>();
  flownFlights.forEach(f => {
    const depCode = f.depIata || f.depIcao;
    const arrCode = f.arrIata || f.arrIcao;

    if (depCode && arrCode) {
      const routeKey = `${depCode}-${arrCode}`;

      // Check if return flight exists
      const hasReturn = flownFlights.some(flight => {
        const fDep = flight.depIata || flight.depIcao;
        const fArr = flight.arrIata || flight.arrIcao;
        return fDep === arrCode && fArr === depCode;
      });

      if (hasReturn) {
        roundTrips.set(routeKey, (roundTrips.get(routeKey) || 0) + 1);
      }
    }
  });
  const roundTripCount = Math.floor(Array.from(roundTrips.values()).reduce((a, b) => a + b, 0) / 2);

  return {
    timeTravelIndex: timeTravelFlights,
    equatorCrossings,
    arcticFlights,
    oceanCrossings,
    highestAirport,
    northernmost,
    southernmost,
    longestTravelChain: longestChain,
    fastestRoute,
    mostCountriesInDay,
    mostCountriesDate,
    hemisphereHops,
    dateLineCrossings,
    continentalExplorer: continents.size,
    continents: Array.from(continents),
    tropicsTraveler: tropicsFlights,
    eastWestBalance: {
      eastward: eastwardFlights,
      westward: westwardFlights,
      ratio: westwardFlights > 0 ? Math.round((eastwardFlights / westwardFlights) * 100) / 100 : eastwardFlights,
    },
    sameDayFlights,
    midnightFlights,
    seasonalExplorer: seasons.size === 4,
    seasonsCount: seasons.size,
    internationalVsDomestic: {
      international: internationalFlights,
      domestic: domesticFlights,
      ratio: domesticFlights > 0 ? Math.round((internationalFlights / domesticFlights) * 100) / 100 : internationalFlights,
    },
    longestLayover,
    roundTripMaster: roundTripCount,
  };
}

/**
 * Convert a UTC Date to minutes-since-midnight in the given IANA timezone.
 * Used for the time-travel index: if local arrival < local departure the
 * clock appeared to go backwards.
 */
function toLocalMinutes(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(date);
    const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
    return h * 60 + m;
  } catch {
    // Fallback to UTC if the timezone string is invalid/unrecognised
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

/**
 * Convert a Date to a local date string (YYYY-MM-DD) in the given timezone.
 * Falls back to the Date's UTC date if timezone is null.
 * Since stored times are local wall-clock as fake-UTC, the fallback is fine
 * for same-timezone flights.
 */
function toLocalDateString(date: Date, timezone: string | null): string {
  if (!timezone) {
    return date.toISOString().split('T')[0];
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    return parts; // en-CA gives YYYY-MM-DD format
  } catch {
    return date.toISOString().split('T')[0];
  }
}

/**
 * Get continent from coordinates (simplified)
 * Similar to getContinent in achievements.ts — keep both in sync when updating boundaries.
 */
function getContinentFromCoordinates(lat: number, lon: number): string | null {
  // Simplified continent detection based on coordinates — rough approximation.
  if (lat > 70 || lat < -60) return 'Antarctica';
  if (lon >= -170 && lon <= -30) {
    return lat > 15 ? 'North America' : 'South America';
  }
  // Middle East: roughly Israel/Jordan east to Iran/UAE, lat 10°–42°N
  // Lower lon bound at 30° keeps Turkey (Istanbul lon ~29) in Europe.
  if (lon >= 30 && lon <= 63 && lat >= 10 && lat <= 42) return 'Middle East';
  // Europe: lon -30° to 40°, lat > 35°N
  if (lon >= -30 && lon <= 40 && lat > 35) return 'Europe';
  // Africa: lon -20° to 55°, lat -35° to 35°
  if (lon >= -20 && lon <= 55 && lat >= -35 && lat < 35) return 'Africa';
  if (lon >= 60 && lon <= 150) return 'Asia';
  if (lon >= 150 || lon <= -170) return 'Oceania';
  return null;
}
