import { prisma } from '../db';
import { Achievement, UserAchievement } from '@prisma/client';
import { calculateDistance } from './geo';
import logger from './logger';
import { getCachedAirports } from '../services/airportCache';

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
  departureTime: Date;
  arrivalTime: Date;
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

    // Get user's existing achievements
    const existingAchievements = await prisma.userAchievement.findMany({
      where: { userId },
    });

    const existingAchievementMap = new Map(
      existingAchievements.map(ua => [ua.achievementId, ua])
    );

    // Get user's flights
    const flights = await prisma.flight.findMany({
      where: { userId, status: 'flown' },
      orderBy: { departureTime: 'asc' },
    });

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
  nightFlights: number;
  weekendFlights: number;
  monthsWithFlights: Set<string>;
  routeCounts: Map<string, number>;
  airlineCounts: Map<string, number>;
  flightsByMonth: Map<string, number>;
  flightsByYear: Map<string, number>;
}

async function calculateUserStats(flights: FlightData[]): Promise<UserStats> {
  const stats: UserStats = {
    flightsCount: flights.length,
    totalDistance: 0,
    totalFlightHours: 0,
    countries: new Set(),
    airlines: new Set(),
    airports: new Set(),
    continents: new Set(),
    aircraftTypes: new Set(),
    longestSingleFlight: 0,
    nightFlights: 0,
    weekendFlights: 0,
    monthsWithFlights: new Set(),
    routeCounts: new Map(),
    airlineCounts: new Map(),
    flightsByMonth: new Map(),
    flightsByYear: new Map(),
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

    // Flight time
    const flightTime =
      (flight.arrivalTime.getTime() - flight.departureTime.getTime()) / 1000 / 60 / 60; // hours
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

    // Aircraft types
    if (flight.aircraft) {
      stats.aircraftTypes.add(flight.aircraft);
    }

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

    // Route counts
    const routeKey = `${depCode}-${arrCode}`;
    const routeCount = stats.routeCounts.get(routeKey) || 0;
    stats.routeCounts.set(routeKey, routeCount + 1);
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
    // Arrive before departure (in UTC)
    if (flight.arrivalTime < flight.departureTime) {
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
    const month = flight.departureTime.getMonth(); // 0-11
    if (month >= 2 && month <= 4) seasons.add(0); // Spring (Mar-May)
    if (month >= 5 && month <= 7) seasons.add(1); // Summer (Jun-Aug)
    if (month >= 8 && month <= 10) seasons.add(2); // Fall (Sep-Nov)
    if (month === 11 || month === 0 || month === 1) seasons.add(3); // Winter (Dec-Feb)
  }
  return seasons.size;
}

function getContinent(lat: number, lon: number): string | null {
  // Simplified continent detection based on coordinates
  // This is a rough approximation
  if (lat > 70 || lat < -60) return 'Antarctica';
  if (lon >= -170 && lon <= -30) {
    return lat > 15 ? 'North America' : 'South America';
  }
  if (lon >= -30 && lon <= 60) {
    // ~15°N is the rough Sahara boundary between Europe/Middle East and sub-Saharan Africa
    return lat >= 15 ? 'Europe' : 'Africa';
  }
  if (lon >= 60 && lon <= 150) return 'Asia';
  if (lon >= 150 || lon <= -170) return 'Oceania';
  return null;
}
