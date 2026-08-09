// Per-user flight statistics used by the achievement engine.
// Extracted from `achievements.ts` so that file stays under the
// 800-line limit mandated by CLAUDE.md.

import { calculateDistance } from './geo';
import { getContinent } from './continents';
import logger from './logger';
import { getCachedAirports } from '../services/airportCache';
import { normalizeAircraft } from './aircraftNormalize';
import {
  HIGH_ALTITUDE_AIRPORTS,
  ISLAND_AIRPORTS,
  JUMBO_SUBSTRINGS,
  LONG_HAUL_MIN_KM,
  MICRO_STATES,
  PILGRIM_AIRPORTS,
  SCANDINAVIA_AIRPORTS,
  SHORT_HAUL_MAX_KM,
  TURBO_PROP_SUBSTRINGS,
  ULTRA_LONG_HAUL_MIN_KM,
  WIDE_BODY_SUBSTRINGS,
  airlineAllianceOf,
  isLowCostCarrier,
  matchesAircraftBucket,
} from './achievementData';

export interface FlightData {
  id: string;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  depIcao: string | null;
  depIata: string | null;
  arrIcao: string | null;
  arrIata: string | null;
  airline: string | null;
  aircraft: string | null;
  flightNumber: string | null;
  seatNumber: string | null;
  seatClass: string | null;
  notes: string | null;
  actualDeparture: Date | null;
  delayMinutes: number | null;
  departureTime: Date | null;
  arrivalTime: Date | null;
  status: string;
  /** Sonder-Flug discriminator — `null` for normal scheduled flights. */
  specialType: string | null;
}

export interface UserStats {
  flightsCount: number;
  totalDistance: number;
  totalFlightHours: number;
  countries: Set<string>;
  airlines: Set<string>;
  airports: Set<string>;
  continents: Set<string>;
  aircraftTypes: Set<string>;
  longestSingleFlight: number;
  shortestSingleFlight: number;
  nightFlights: number;
  weekendFlights: number;
  monthsWithFlights: Set<string>;
  routeCounts: Map<string, number>;
  airlineCounts: Map<string, number>;
  flightsByMonth: Map<string, number>;
  flightsByYear: Map<string, number>;
  // Planner / Survivor stats (computed from all flights, not just flown)
  scheduledCount: number;
  scheduledContinents: Set<string>;
  scheduledMaxAdvanceDays: number;
  cancelledCount: number;
  // v1.1 expansion
  duplicatedCount: number;
  islandFlights: number;
  microStatesVisited: Set<string>;
  scandinaviaSet: Set<string>;
  highAltitudeFlights: number;
  pilgrimFlights: number;
  wideBodyCount: number;
  turboPropCount: number;
  jumboCount: number;
  airlineAlliances: Set<'star' | 'skyteam' | 'oneworld'>;
  airportAlphabet: Set<string>;
  lowcostCount: number;
  firstClassFlights: number;
  premiumTrifecta: Set<'short' | 'long' | 'ultra'>;
  redEyeFlights: number;
  earlyMorningFlights: number;
  windowStreak: number;
  middleStreak: number;
  notesCount: number;
  groundhogRoute: number;
  scheduled30d: number;
  delayedFlights: number;
  tightConnection: number;
  birthdayFlights: number;
  nyeAirborne: number;
  leapDayFlights: number;
  hasMicroFlight: number;
  icaoDayFlights: number;
  wrightDayFlights: number;
  mayFourthFlights: number;
  piDayFlights: number;
  piPrecisionFlights: number;
  halloweenFlights: number;
  // Sonder-Flüge — counts per signature type, plus a distinct-type
  // counter for the "variety" achievement.
  specialSightseeingCount: number;
  specialZerogCount: number;
  specialEclipseCount: number;
  specialRocketCount: number;
  /** Number of distinct specialType values present in the user's
   *  flights — any of the 8 enum values counts as one. */
  specialVariety: number;
  // Cruise stats (V1 multi-domain)
  cruisesCount: number;
  cruisePortsUnique: number;
  cruisePortsSingleMax: number;
  cruiseShipsUnique: number;
  cruiseLines: Set<string>;
  cruiseLinesUnique: number;
  cruiseLineLoyaltyMax: number;
  seaDays: number;
  seaDaysStreak: number;
  cruiseRegions: Set<string>;
  hasBalconyCabin: boolean;
  hasSuiteCabin: boolean;
  cruiseMaxDeck: number;
  hasCanalTransit: boolean;
  hasPolar: boolean;
  hasColdWater: boolean;
  hasCruiseBirthdayAtSea: boolean;
  hasNewYearsAtSea: boolean;
  /** Sum of great-circle hops between consecutive port calls across
   * all cruises (km). Approximates total cruise distance for the
   * cruise distance ladder. */
  cruiseTotalDistanceKm: number;
  /** Single longest leg (km) across all cruises. Used by the
   * Off-Chart Navigator hidden egg to detect open-water crossings. */
  cruiseLongestLegKm: number;
  /** True when any cruise leg crosses the antimeridian. Hidden egg. */
  hasCruiseDatelineCrossing: boolean;
  // Cross-domain
  hasFlyAndSailTrip: boolean;
  /** True when any flight is within ±7 days of any cruise start/end.
   * Tighter than the trip-bundle Fly & Sail and works even when the
   * user didn't link the entries via the same trip id. */
  hasFlyAndSail7d: boolean;
  cruiseCarnivalBrandsCovered: number; // how many Carnival brands out of the set
  // Lodging stats (V1 multi-domain)
  lodgingsCount: number;
  /** Number of individual stays (bookings), as distinct from `lodgingsCount`
   * (distinct lodgings) — a user can have many stays at the same hotel. */
  lodgingStaysCount: number;
  lodgingNights: number;
  lodgingChainsUnique: number;
  lodgingCountries: Set<string>;
  lodgingSpendBase: number;
  lodgingAwardNights: number;
  lodgingChainLoyaltyMax: number;
  lodgingSameHotelRepeatMax: number;
  lodgingLongestStayNights: number;
  // Cross-domain (lodging)
  /** True when a single trip links at least one flight AND at least one
   * lodging stay. Computed by `computeFlyAndStayFlags` from per-trip
   * domain counts — see that function for why "user has flights
   * somewhere + stays somewhere" is NOT the same test. */
  flyAndStay: boolean;
  /** True when a single trip links a flight, a cruise, AND a lodging
   * stay. Strictly stronger than `flyAndStay`. */
  grandTour: boolean;
}

// The coordinate-box implementation that used to live here called the Arctic
// 'Antarctica', called Australia 'Asia', and returned a phantom eighth continent
// ('Middle East') that made CONTINENTS_7 reachable without ever going south.
// It now lives in `utils/continents.ts`, resolves by ISO country, and is the only
// copy — `utils/stats/uniqueStats.ts` used to carry a byte-identical duplicate.
// Re-exported here so the existing import sites keep working.
export { getContinent };

export async function calculateUserStats(flights: FlightData[]): Promise<UserStats> {
  const stats: UserStats = {
    // Historical flights are real past flights and count toward "flights_count"
    // achievements. Time-sensitive sub-stats below stay narrowed to `flown`.
    flightsCount: flights.filter(
      f => f.status === 'flown' || f.status === 'historical'
    ).length,
    totalDistance: 0,
    totalFlightHours: 0,
    countries: new Set(),
    airlines: new Set(),
    airports: new Set(),
    continents: new Set(),
    aircraftTypes: new Set(),
    longestSingleFlight: 0,
    shortestSingleFlight: Number.POSITIVE_INFINITY,
    nightFlights: 0,
    weekendFlights: 0,
    monthsWithFlights: new Set(),
    routeCounts: new Map(),
    airlineCounts: new Map(),
    flightsByMonth: new Map(),
    flightsByYear: new Map(),
    scheduledCount: 0,
    scheduledContinents: new Set(),
    scheduledMaxAdvanceDays: 0,
    cancelledCount: 0,
    // v1.1
    duplicatedCount: 0,
    islandFlights: 0,
    microStatesVisited: new Set(),
    scandinaviaSet: new Set(),
    highAltitudeFlights: 0,
    pilgrimFlights: 0,
    wideBodyCount: 0,
    turboPropCount: 0,
    jumboCount: 0,
    airlineAlliances: new Set(),
    airportAlphabet: new Set(),
    lowcostCount: 0,
    firstClassFlights: 0,
    premiumTrifecta: new Set(),
    redEyeFlights: 0,
    earlyMorningFlights: 0,
    windowStreak: 0,
    middleStreak: 0,
    notesCount: 0,
    groundhogRoute: 0,
    scheduled30d: 0,
    delayedFlights: 0,
    tightConnection: 0,
    birthdayFlights: 0,
    nyeAirborne: 0,
    leapDayFlights: 0,
    hasMicroFlight: 0,
    icaoDayFlights: 0,
    wrightDayFlights: 0,
    mayFourthFlights: 0,
    piDayFlights: 0,
    piPrecisionFlights: 0,
    halloweenFlights: 0,
    specialSightseeingCount: 0,
    specialZerogCount: 0,
    specialEclipseCount: 0,
    specialRocketCount: 0,
    specialVariety: 0,
    // Cruise stats — filled in by caller via spread after calculateCruiseStats
    cruisesCount: 0,
    cruisePortsUnique: 0,
    cruisePortsSingleMax: 0,
    cruiseShipsUnique: 0,
    cruiseLines: new Set(),
    cruiseLinesUnique: 0,
    cruiseLineLoyaltyMax: 0,
    seaDays: 0,
    seaDaysStreak: 0,
    cruiseRegions: new Set(),
    hasBalconyCabin: false,
    hasSuiteCabin: false,
    cruiseMaxDeck: 0,
    hasCanalTransit: false,
    hasPolar: false,
    hasColdWater: false,
    hasCruiseBirthdayAtSea: false,
    hasNewYearsAtSea: false,
    cruiseTotalDistanceKm: 0,
    cruiseLongestLegKm: 0,
    hasCruiseDatelineCrossing: false,
    hasFlyAndSailTrip: false,
    hasFlyAndSail7d: false,
    cruiseCarnivalBrandsCovered: 0,
    // Lodging stats — filled in by caller via spread after calculateLodgingStats
    lodgingsCount: 0,
    lodgingStaysCount: 0,
    lodgingNights: 0,
    lodgingChainsUnique: 0,
    lodgingCountries: new Set(),
    lodgingSpendBase: 0,
    lodgingAwardNights: 0,
    lodgingChainLoyaltyMax: 0,
    lodgingSameHotelRepeatMax: 0,
    lodgingLongestStayNights: 0,
    flyAndStay: false,
    grandTour: false,
  };

  // Collect all unique airport codes from flights
  const airportCodes = new Set<string>();
  for (const flight of flights) {
    const depCode = flight.depIata || flight.depIcao;
    const arrCode = flight.arrIata || flight.arrIcao;
    if (depCode) airportCodes.add(depCode);
    if (arrCode) airportCodes.add(arrCode);
  }

  // Batch fetch airports using cache
  let airportMap: Map<string, { country: string | null; lat: number; lon: number }>;
  try {
    const cachedAirports = await getCachedAirports(Array.from(airportCodes));
    airportMap = new Map();

    // Convert cached airports to the format we need
    for (const [code, airport] of cachedAirports.entries()) {
      if (airport) {
        airportMap.set(code, {
          country: airport.country || null,
          lat: airport.lat,
          lon: airport.lon,
        });
      }
    }
  } catch (error) {
    logger.error({
      operation: 'fetch_airports_for_stats',
      message: 'Failed to fetch airports for user stats calculation',
      context: { flightCount: flights.length, airportCodeCount: airportCodes.size },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }

  for (const flight of flights) {
    // Distance
    const distance = calculateDistance(
      flight.depLat,
      flight.depLon,
      flight.arrLat,
      flight.arrLon
    );
    stats.totalDistance += distance;
    stats.longestSingleFlight = Math.max(stats.longestSingleFlight, distance);
    if (distance > 0) {
      stats.shortestSingleFlight = Math.min(stats.shortestSingleFlight, distance);
      if (distance < 250) stats.hasMicroFlight = 1;
    }

    // Flight time (historical flights have null times — contribute 0 hours)
    const flightTime = (flight.departureTime && flight.arrivalTime)
      ? (flight.arrivalTime.getTime() - flight.departureTime.getTime()) / 1000 / 60 / 60
      : 0;
    stats.totalFlightHours += flightTime;

    // Airports
    const depCode = flight.depIata || flight.depIcao;
    const arrCode = flight.arrIata || flight.arrIcao;
    if (depCode) stats.airports.add(depCode);
    if (arrCode) stats.airports.add(arrCode);

    // Countries
    const depAirport = airportMap.get(depCode || '');
    const arrAirport = airportMap.get(arrCode || '');
    if (depAirport?.country) stats.countries.add(depAirport.country);
    if (arrAirport?.country) stats.countries.add(arrAirport.country);

    // Continents — resolved from the airport's ISO country, with the coordinates only
    // as a fallback. The country is exact; boxes drawn on a lat/lon grid are not.
    if (depAirport) {
      const continent = getContinent(depAirport.lat, depAirport.lon, depAirport.country);
      if (continent) stats.continents.add(continent);
    }
    if (arrAirport) {
      const continent = getContinent(arrAirport.lat, arrAirport.lon, arrAirport.country);
      if (continent) stats.continents.add(continent);
    }

    // Airlines
    if (flight.airline) {
      stats.airlines.add(flight.airline);
      const count = stats.airlineCounts.get(flight.airline) || 0;
      stats.airlineCounts.set(flight.airline, count + 1);
    }

    // Aircraft types (normalized to canonical names)
    if (flight.aircraft) {
      stats.aircraftTypes.add(normalizeAircraft(flight.aircraft));
    }

    // Time-based stats — only applicable when departure time is known.
    // Time-of-day buckets (night/weekend) require precise local hour and
    // weekday, so they are gated to `flown` only — historical flights with
    // 12:00 placeholders would skew the counts. Year/month aggregation
    // (monthsWithFlights, flightsByMonth, flightsByYear) is reliable enough
    // for historical flights so those remain inclusive.
    if (flight.departureTime) {
      if (flight.status === 'flown') {
        // Night flights (00:00 - 06:00)
        const depHour = flight.departureTime.getHours();
        if (depHour >= 0 && depHour < 6) {
          stats.nightFlights++;
        }

        // Weekend flights
        const depDay = flight.departureTime.getDay();
        if (depDay === 0 || depDay === 6) {
          stats.weekendFlights++;
        }
      }

      // Months with flights
      const monthKey = `${flight.departureTime.getFullYear()}-${String(
        flight.departureTime.getMonth() + 1
      ).padStart(2, '0')}`;
      stats.monthsWithFlights.add(monthKey);

      const monthCount = stats.flightsByMonth.get(monthKey) || 0;
      stats.flightsByMonth.set(monthKey, monthCount + 1);

      // Years with flights
      const yearKey = String(flight.departureTime.getFullYear());
      const yearCount = stats.flightsByYear.get(yearKey) || 0;
      stats.flightsByYear.set(yearKey, yearCount + 1);
    }

    // Route counts
    const routeKey = `${depCode}-${arrCode}`;
    const routeCount = stats.routeCounts.get(routeKey) || 0;
    stats.routeCounts.set(routeKey, routeCount + 1);

    // ── v1.1 expansion ──────────────────────────────────────────────

    // Airport-based: islands, high altitude, pilgrim routes, alphabet
    for (const code of [depCode, arrCode]) {
      if (!code) continue;
      if (ISLAND_AIRPORTS.has(code)) stats.islandFlights++;
      if (HIGH_ALTITUDE_AIRPORTS.has(code)) stats.highAltitudeFlights++;
      if (PILGRIM_AIRPORTS.has(code)) stats.pilgrimFlights++;
      if (SCANDINAVIA_AIRPORTS.has(code)) stats.scandinaviaSet.add(code);
      const firstLetter = code.charAt(0).toUpperCase();
      if (/[A-Z]/.test(firstLetter)) stats.airportAlphabet.add(firstLetter);
    }

    // Micro-states (by airport country)
    for (const airport of [depAirport, arrAirport]) {
      if (airport?.country && MICRO_STATES.has(airport.country)) {
        stats.microStatesVisited.add(airport.country);
      }
    }

    // Aircraft buckets
    if (matchesAircraftBucket(flight.aircraft, WIDE_BODY_SUBSTRINGS)) stats.wideBodyCount++;
    if (matchesAircraftBucket(flight.aircraft, TURBO_PROP_SUBSTRINGS)) stats.turboPropCount++;
    if (matchesAircraftBucket(flight.aircraft, JUMBO_SUBSTRINGS)) stats.jumboCount++;

    // Airline alliance + low-cost
    const alliance = airlineAllianceOf(flight.airline);
    if (alliance) stats.airlineAlliances.add(alliance);
    if (isLowCostCarrier(flight.airline)) stats.lowcostCount++;

    // Cabin class + premium trifecta (requires distance bucket)
    if (flight.seatClass === 'first') stats.firstClassFlights++;
    const isPremium = flight.seatClass === 'first' || flight.seatClass === 'business';
    if (isPremium && distance > 0) {
      if (distance <= SHORT_HAUL_MAX_KM) {
        stats.premiumTrifecta.add('short');
      } else if (distance >= ULTRA_LONG_HAUL_MIN_KM) {
        stats.premiumTrifecta.add('ultra');
      } else if (distance >= LONG_HAUL_MIN_KM) {
        stats.premiumTrifecta.add('long');
      }
    }

    // Red-eye / not-a-morning-person (departure hour local) — needs precise
    // local hour, so flown-only. Historical placeholders would skew this.
    if (flight.departureTime && flight.status === 'flown') {
      const h = flight.departureTime.getHours();
      if (h >= 23 || h < 5) stats.redEyeFlights++;
      if (h >= 4 && h < 7) stats.earlyMorningFlights++;
    }

    // Notes
    if (flight.notes && flight.notes.trim().length > 0) stats.notesCount++;

    // Delays (actualDeparture - scheduled ≥ 60 min, or delayMinutes if populated)
    if (flight.delayMinutes != null && flight.delayMinutes >= 60) {
      stats.delayedFlights++;
    } else if (flight.actualDeparture && flight.departureTime) {
      const diffMin = (flight.actualDeparture.getTime() - flight.departureTime.getTime()) / 60000;
      if (diffMin >= 60) stats.delayedFlights++;
    }

    // NYE airborne — a flight whose arrival is in a different calendar year than departure
    if (flight.departureTime && flight.arrivalTime) {
      const dep = flight.departureTime;
      const arr = flight.arrivalTime;
      if (dep.getMonth() === 11 && dep.getDate() === 31 && arr.getFullYear() > dep.getFullYear()) {
        stats.nyeAirborne++;
      }
      if (dep.getMonth() === 1 && dep.getDate() === 29) stats.leapDayFlights++;
    }

    // Calendar-observance easter eggs (month is 0-indexed)
    if (flight.departureTime) {
      const d = flight.departureTime;
      const month = d.getMonth();
      const day = d.getDate();
      if (month === 11 && day === 7) stats.icaoDayFlights++;           // 7 Dec — ICAO Day
      if (month === 7 && day === 19) stats.wrightDayFlights++;         // 19 Aug — National Aviation Day
      if (month === 4 && day === 4) stats.mayFourthFlights++;          // 4 May — Star Wars Day
      if (month === 2 && day === 14) {
        stats.piDayFlights++;                                          // 14 Mar — Pi Day
        // π Precision: great-circle distance within ±5 % of 3141 km
        if (distance >= 3141 * 0.95 && distance <= 3141 * 1.05) {
          stats.piPrecisionFlights++;
        }
      }
      if (month === 9 && day === 31) stats.halloweenFlights++;         // 31 Oct — Halloween
    }

    // Sonder-Flüge counts — per-type counters for the "first X" single-event
    // achievements. Every special flight counts regardless of status
    // (scheduled eclipse chases are milestones in the real world even
    // before they fly).
    if (flight.specialType) {
      if (flight.specialType === 'sightseeing') stats.specialSightseeingCount++;
      else if (flight.specialType === 'zerog') stats.specialZerogCount++;
      else if (flight.specialType === 'eclipse') stats.specialEclipseCount++;
      else if (flight.specialType === 'rocket_launch') stats.specialRocketCount++;
    }
  }

  // specialVariety — number of distinct specialType values seen.
  const specialTypeSet = new Set<string>();
  for (const flight of flights) {
    if (flight.specialType) specialTypeSet.add(flight.specialType);
  }
  stats.specialVariety = specialTypeSet.size;

  // Reset shortestSingleFlight if no flights
  if (stats.shortestSingleFlight === Number.POSITIVE_INFINITY) stats.shortestSingleFlight = 0;

  // Cross-flight computations
  const sorted = [...flights]
    .filter((f) => f.status === 'flown' && f.departureTime)
    .sort((a, b) => (a.departureTime!.getTime() - b.departureTime!.getTime()));

  // Window / Middle streaks (based on seatNumber last char: A/F typically window, B/E middle — rough)
  let winRun = 0;
  let maxWin = 0;
  let midRun = 0;
  let maxMid = 0;
  for (const f of sorted) {
    const seat = f.seatNumber?.toUpperCase().match(/[A-Z]$/)?.[0];
    if (!seat) {
      winRun = 0;
      midRun = 0;
      continue;
    }
    // Conventional narrow-body mapping: A / F / K = window, C / D = aisle, B / E = middle
    if (seat === 'A' || seat === 'F' || seat === 'K') {
      winRun++;
      maxWin = Math.max(maxWin, winRun);
      midRun = 0;
    } else if (seat === 'B' || seat === 'E') {
      midRun++;
      maxMid = Math.max(maxMid, midRun);
      winRun = 0;
    } else {
      winRun = 0;
      midRun = 0;
    }
  }
  stats.windowStreak = maxWin;
  stats.middleStreak = maxMid;

  // Groundhog Day — same route on three consecutive calendar days
  const routesByDay = new Map<string, Set<string>>();
  for (const f of sorted) {
    const key = (f.departureTime!.toISOString().slice(0, 10));
    const route = `${f.depIata || f.depIcao}-${f.arrIata || f.arrIcao}`;
    if (!routesByDay.has(key)) routesByDay.set(key, new Set());
    routesByDay.get(key)!.add(route);
  }
  const days = Array.from(routesByDay.keys()).sort();
  let maxGroundhog = 0;
  for (let i = 0; i < days.length; i++) {
    for (const route of routesByDay.get(days[i])!) {
      let streak = 1;
      let prev = new Date(days[i]);
      for (let j = i + 1; j < days.length; j++) {
        const curr = new Date(days[j]);
        const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
        if (diff === 1 && routesByDay.get(days[j])!.has(route)) {
          streak++;
          prev = curr;
        } else if (diff > 1) {
          break;
        }
      }
      maxGroundhog = Math.max(maxGroundhog, streak);
    }
  }
  stats.groundhogRoute = maxGroundhog;

  // Tight connection — any consecutive flight pair where arrival airport == next departure airport,
  // and the gap between arrivalTime and next departureTime is < 45 minutes (but > 0).
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!a.arrivalTime || !b.departureTime) continue;
    const aArr = a.arrIata || a.arrIcao;
    const bDep = b.depIata || b.depIcao;
    if (aArr && bDep && aArr === bDep) {
      const gapMin = (b.departureTime.getTime() - a.arrivalTime.getTime()) / 60000;
      if (gapMin > 0 && gapMin < 45) {
        stats.tightConnection++;
      }
    }
  }

  return stats;
}

/**
 * Per-trip domain counts, as a caller would derive them from
 * `prisma.trip.findMany({ include: { flights: true, cruises: true,
 * lodgingStays: true } })` (or a `_count` select) — one entry per trip.
 */
export interface TripDomainCounts {
  flightCount: number;
  cruiseCount: number;
  lodgingStayCount: number;
}

/**
 * Derives the cross-domain `flyAndStay` / `grandTour` flags from
 * per-trip domain counts.
 *
 * Both flags are per-TRIP conditions, not per-user: a user who has
 * flights in one trip and a lodging stay in a completely separate trip
 * must NOT satisfy `flyAndStay` — only a trip that itself links both a
 * flight and a stay counts. This mirrors how `achievements.ts` already
 * computes the cruise-side `hasFlyAndSailTrip` (`c.trip.flights.length >
 * 0 && c.trip.cruises.length > 0`), extended with the lodging domain.
 */
export function computeFlyAndStayFlags(trips: TripDomainCounts[]): {
  flyAndStay: boolean;
  grandTour: boolean;
} {
  const flyAndStay = trips.some((t) => t.flightCount > 0 && t.lodgingStayCount > 0);
  const grandTour = trips.some(
    (t) => t.flightCount > 0 && t.cruiseCount > 0 && t.lodgingStayCount > 0,
  );
  return { flyAndStay, grandTour };
}

/**
 * Unions "countries visited" sets from every domain (flights, cruises,
 * lodging stays, …) into the single figure `UserStats.countries`
 * exposes. Pulled out as its own function so the lodging domain's
 * countries can be folded in the same way the cruise-port countries
 * already are in `achievements.ts`, rather than each caller
 * re-implementing the union by hand.
 */
export function unionCountries(...countrySets: Array<Set<string>>): Set<string> {
  const union = new Set<string>();
  for (const set of countrySets) {
    for (const country of set) union.add(country);
  }
  return union;
}
