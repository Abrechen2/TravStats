import { prisma } from '../db';
import { Achievement, UserAchievement } from '@prisma/client';
import { calculateDistance } from './geo';
import logger from './logger';
import { getCachedAirports } from '../services/airportCache';
import { normalizeAircraft } from './aircraftNormalize';
import {
  AIRLINE_ALLIANCES,
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

type UserAchievementWithRelation = UserAchievement & { achievement: Achievement };

interface FlightData {
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
}

/**
 * Check and update achievements for a user
 * Returns newly unlocked achievements
 * Uses transactions to prevent race conditions and ensure data consistency
 */
export async function checkAndUpdateAchievements(userId: string): Promise<UserAchievementWithRelation[]> {
  try {
    // Get all achievements
    const allAchievements = await prisma.achievement.findMany();

    // Fetch user-level context we need for a few of the new achievements
    // (Birthday Flight needs month+day of birthdate).
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { birthdate: true },
    });

    // Get user's existing achievements
    const existingAchievements = await prisma.userAchievement.findMany({
      where: { userId },
    });

    const existingAchievementMap = new Map(
      existingAchievements.map(ua => [ua.achievementId, ua])
    );

    // Get user's flights (flown+historical for geo/distance stats, all for planner/survivor)
    const [flights, allFlights] = await Promise.all([
      prisma.flight.findMany({
        where: { userId, status: { in: ['flown', 'historical'] } },
        orderBy: { departureTime: 'asc' },
      }),
      prisma.flight.findMany({
        where: { userId },
        orderBy: { departureTime: 'asc' },
      }),
    ]);

    // Calculate user stats with error handling
    let stats;
    try {
      stats = await calculateUserStats(flights);
    } catch (error) {
      logger.error({
        operation: 'calculate_user_stats',
        message: 'Failed to calculate user stats for achievements',
        context: { userId, flightCount: flights.length },
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
      throw error;
    }

    // Compute planner/survivor stats from all flights (not just flown)
    const now = Date.now();
    const scheduled = allFlights.filter(f => f.status === 'scheduled');
    stats.scheduledCount = scheduled.length;
    stats.cancelledCount = allFlights.filter(f => f.status === 'cancelled').length;
    stats.duplicatedCount = allFlights.filter(f => f.status === 'duplicated').length;

    for (const f of scheduled) {
      if (!f.departureTime) continue;
      const advanceDays = Math.floor((f.departureTime.getTime() - now) / (1000 * 60 * 60 * 24));
      if (advanceDays > stats.scheduledMaxAdvanceDays) {
        stats.scheduledMaxAdvanceDays = advanceDays;
      }
      const continent = getContinent(f.depLat, f.depLon);
      if (continent) stats.scheduledContinents.add(continent);
      const arrContinent = getContinent(f.arrLat, f.arrLon);
      if (arrContinent) stats.scheduledContinents.add(arrContinent);
    }

    // Birthday Flight — count flown flights whose departureTime month+day
    // matches the user's stored birthdate (year irrelevant).
    if (user?.birthdate) {
      const bMonth = user.birthdate.getMonth();
      const bDay = user.birthdate.getDate();
      stats.birthdayFlights = flights.filter(
        (f) =>
          f.status === 'flown' &&
          f.departureTime &&
          f.departureTime.getMonth() === bMonth &&
          f.departureTime.getDate() === bDay,
      ).length;
    }

    // Schedule Keeper — max scheduled-flights count inside any rolling 30-day window.
    const scheduledSorted = scheduled
      .filter((f) => f.departureTime)
      .sort((a, b) => a.departureTime!.getTime() - b.departureTime!.getTime());
    if (scheduledSorted.length > 0) {
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      let left = 0;
      let maxWindow = 0;
      for (let right = 0; right < scheduledSorted.length; right++) {
        while (
          scheduledSorted[right].departureTime!.getTime() -
            scheduledSorted[left].departureTime!.getTime() >
          THIRTY_DAYS
        ) {
          left++;
        }
        maxWindow = Math.max(maxWindow, right - left + 1);
      }
      stats.scheduled30d = maxWindow;
    }

    // Prepare all updates/creates to execute in a single transaction
    // Use callback-based transaction to prevent race conditions
    const newlyUnlocked: UserAchievementWithRelation[] = [];

    try {
      await prisma.$transaction(async (tx) => {
        for (const achievement of allAchievements) {
          const existing = existingAchievementMap.get(achievement.id);
          const alreadyUnlocked =
            existing && existing.progress >= achievement.requirement;

          if (alreadyUnlocked) {
            continue;
          }

          const { isUnlocked, progress } = checkAchievement(achievement, stats, flights);

          if (isUnlocked) {
            if (existing) {
              const updated = await tx.userAchievement.update({
                where: { id: existing.id },
                data: {
                  progress: achievement.requirement,
                  unlockedAt: new Date(),
                },
                include: { achievement: true },
              });
              newlyUnlocked.push(updated);
            } else {
              const userAchievement = await tx.userAchievement.create({
                data: {
                  userId,
                  achievementId: achievement.id,
                  progress: achievement.requirement,
                },
                include: { achievement: true },
              });
              newlyUnlocked.push(userAchievement);
            }
          } else {
            // Update or create progress for non-unlocked achievements
            if (existing) {
              await tx.userAchievement.update({
                where: { id: existing.id },
                data: { progress },
              });
            } else if (progress > 0) {
              // Create new entry only if there's some progress (avoid cluttering DB with 0 progress)
              await tx.userAchievement.create({
                data: {
                  userId,
                  achievementId: achievement.id,
                  progress,
                },
              });
            }
          }
        }
      });
    } catch (error) {
      logger.error({
        operation: 'update_achievements_transaction',
        message: 'Failed to update achievements in transaction',
        context: { userId, achievementCount: allAchievements.length },
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
      throw error;
    }

    if (newlyUnlocked.length > 0) {
      logger.info({
        operation: 'achievements_unlocked',
        message: `User unlocked ${newlyUnlocked.length} achievement(s)`,
        context: { userId, achievementIds: newlyUnlocked.map(ua => ua.achievement.id) },
      });
    }

    return newlyUnlocked;
  } catch (error) {
    logger.error({
      operation: 'check_and_update_achievements',
      message: 'Failed to check and update achievements',
      context: { userId },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    // Re-throw to allow caller to handle
    throw error;
  }
}

interface UserStats {
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
}

async function calculateUserStats(flights: FlightData[]): Promise<UserStats> {
  const stats: UserStats = {
    flightsCount: flights.filter(f => f.status === 'flown').length,
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

    // Continents (simplified mapping based on coordinates)
    if (depAirport) {
      const continent = getContinent(depAirport.lat, depAirport.lon);
      if (continent) stats.continents.add(continent);
    }
    if (arrAirport) {
      const continent = getContinent(arrAirport.lat, arrAirport.lon);
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

    // Time-based stats — only applicable when departure time is known
    if (flight.departureTime) {
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

    // Red-eye / not-a-morning-person (departure hour local)
    if (flight.departureTime) {
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
  }

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

function checkAchievement(
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

function getContinent(lat: number, lon: number): string | null {
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
