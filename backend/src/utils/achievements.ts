import { prisma } from '../db';
import type { Achievement, UserAchievement } from '@prisma/client';
import logger from './logger';
import {
  calculateUserStats,
  getContinent,
  type FlightData,
} from './achievementStats';
import { checkAchievement } from './achievementChecks';
import { calculateCruiseStats, type CruiseData as CruiseStatsInput } from './cruiseStats';

type UserAchievementWithRelation = UserAchievement & { achievement: Achievement };

// Re-export the shared types so existing callers that imported them from
// `./achievements` keep compiling without touching every import site.
export type { FlightData, UserStats } from './achievementStats';
export { calculateUserStats, getContinent } from './achievementStats';
export { checkAchievement } from './achievementChecks';

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
    // + cruises (all statuses except cancelled; include stops+ports and trip for Fly & Sail)
    const [flights, allFlights, cruises] = await Promise.all([
      prisma.flight.findMany({
        where: { userId, status: { in: ['flown', 'historical'] } },
        orderBy: { departureTime: 'asc' },
      }),
      prisma.flight.findMany({
        where: { userId },
        orderBy: { departureTime: 'asc' },
      }),
      prisma.cruise.findMany({
        where: { userId, status: { not: 'cancelled' } },
        include: {
          stops: { include: { port: true } },
          trip: { include: { flights: true, cruises: true } },
        },
      }),
    ]);

    // Calculate user stats with error handling
    let stats;
    try {
      stats = await calculateUserStats(flights as FlightData[]);
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

    // Compute planner/survivor stats from all flights (not just flown).
    // Build a fresh `augmentedStats` via spread so the `stats` object
    // returned by `calculateUserStats()` is never mutated.
    const now = Date.now();
    const scheduled = allFlights.filter((f) => f.status === 'scheduled');
    const cancelledCount = allFlights.filter((f) => f.status === 'cancelled').length;
    const duplicatedCount = allFlights.filter((f) => f.status === 'duplicated').length;

    const scheduledContinents = new Set(stats.scheduledContinents);
    let scheduledMaxAdvanceDays = stats.scheduledMaxAdvanceDays;
    for (const f of scheduled) {
      if (!f.departureTime) continue;
      const advanceDays = Math.floor((f.departureTime.getTime() - now) / (1000 * 60 * 60 * 24));
      if (advanceDays > scheduledMaxAdvanceDays) {
        scheduledMaxAdvanceDays = advanceDays;
      }
      const continent = getContinent(f.depLat, f.depLon);
      if (continent) scheduledContinents.add(continent);
      const arrContinent = getContinent(f.arrLat, f.arrLon);
      if (arrContinent) scheduledContinents.add(arrContinent);
    }

    // Birthday Flight — count flown flights whose departureTime month+day
    // matches the user's stored birthdate (year irrelevant).
    let birthdayFlights = stats.birthdayFlights;
    if (user?.birthdate) {
      const bMonth = user.birthdate.getMonth();
      const bDay = user.birthdate.getDate();
      birthdayFlights = flights.filter(
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
    let scheduled30d = stats.scheduled30d;
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
      scheduled30d = maxWindow;
    }

    // Cruise stats (multi-domain V1) — computed separately from flight stats.
    const userBirthday = user?.birthdate
      ? { month: user.birthdate.getMonth() + 1, day: user.birthdate.getDate() }
      : undefined;

    const cruiseStatsInput: CruiseStatsInput[] = cruises.map((c) => ({
      id: c.id,
      shipId: c.shipId,
      cruiseLine: c.cruiseLine,
      cabinType: c.cabinType,
      deck: c.deck,
      startDate: c.startDate,
      endDate: c.endDate,
      stops: c.stops.map((s) => ({
        portId: s.portId,
        port: s.port
          ? {
              id: s.port.id,
              name: s.port.name,
              city: s.port.city,
              country: s.port.country,
              region: s.port.region,
              unlocode: s.port.unlocode,
              lat: s.port.lat,
              lon: s.port.lon,
              timezone: s.port.timezone,
              isUserAdded: s.port.isUserAdded,
            }
          : null,
        dayNumber: s.dayNumber,
        isAtSea: s.isAtSea,
        arrivalTime: s.arrivalTime,
        departureTime: s.departureTime,
      })),
    }));

    const cruiseStats = calculateCruiseStats(cruiseStatsInput, userBirthday);

    // Fly & Sail — at least one trip contains BOTH a flight and a cruise
    const flyAndSail = cruises.some(
      (c) => c.trip && c.trip.flights.length > 0 && c.trip.cruises.length > 0,
    );

    // Amphibious Week — fires when any flight sits within ±7 days of a
    // cruise's start or end. Checks ALL flights against ALL cruises;
    // O(F × C) but both lists are small enough that no index is needed.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const cruiseDates = cruises
      .flatMap((c) => [c.startDate, c.endDate])
      .filter((d): d is Date => d instanceof Date);
    const flightDates = flights
      .map((f) => f.departureTime)
      .filter((d): d is Date => d instanceof Date);
    const flyAndSail7d = cruiseDates.some((cd) =>
      flightDates.some((fd) => Math.abs(fd.getTime() - cd.getTime()) <= SEVEN_DAYS_MS),
    );

    // Union flight + cruise countries into the shared countries Set.
    // Same for continents — map each cruise port to its continent via getContinent().
    const combinedCountries = new Set<string>(stats.countries);
    const combinedContinents = new Set<string>(stats.continents);
    for (const c of cruiseStatsInput) {
      for (const stop of c.stops) {
        if (stop.port?.country) combinedCountries.add(stop.port.country);
        if (stop.port) {
          const continent = getContinent(stop.port.lat, stop.port.lon);
          if (continent) combinedContinents.add(continent);
        }
      }
    }

    const augmentedStats = {
      ...stats,
      scheduledCount: scheduled.length,
      cancelledCount,
      duplicatedCount,
      scheduledContinents,
      scheduledMaxAdvanceDays,
      birthdayFlights,
      scheduled30d,
      // Countries + continents now include cruise ports for shared achievements
      countries: combinedCountries,
      continents: combinedContinents,
      // Cruise stats
      cruisesCount: cruiseStats.cruisesCount,
      cruisePortsUnique: cruiseStats.cruisePortsUnique,
      cruisePortsSingleMax: cruiseStats.cruisePortsSingleMax,
      cruiseShipsUnique: cruiseStats.cruiseShipsUnique,
      cruiseLines: cruiseStats.cruiseLines,
      cruiseLinesUnique: cruiseStats.cruiseLinesUnique,
      cruiseLineLoyaltyMax: cruiseStats.cruiseLineLoyaltyMax,
      seaDays: cruiseStats.seaDays,
      seaDaysStreak: cruiseStats.seaDaysStreak,
      cruiseRegions: cruiseStats.regions,
      hasBalconyCabin: cruiseStats.hasBalconyCabin,
      hasSuiteCabin: cruiseStats.hasSuiteCabin,
      cruiseMaxDeck: cruiseStats.maxDeck,
      hasCanalTransit: cruiseStats.hasCanalTransit,
      hasPolar: cruiseStats.hasPolar,
      hasColdWater: cruiseStats.hasColdWater,
      hasCruiseBirthdayAtSea: cruiseStats.hasBirthdayAtSea,
      hasNewYearsAtSea: cruiseStats.hasNewYearsAtSea,
      cruiseTotalDistanceKm: cruiseStats.totalDistanceKm,
      cruiseLongestLegKm: cruiseStats.longestLegKm,
      hasCruiseDatelineCrossing: cruiseStats.hasDatelineCrossing,
      hasFlyAndSailTrip: flyAndSail,
      hasFlyAndSail7d: flyAndSail7d,
      cruiseCarnivalBrandsCovered: 0, // computed inside the checker
    };

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

          const { isUnlocked, progress } = checkAchievement(
            achievement,
            augmentedStats,
            flights as FlightData[],
          );

          // existingAchievementMap is a snapshot from BEFORE the transaction
          // started. Another concurrent invocation (e.g. a cruise POST +
          // flight POST racing together) can insert a row for the same
          // (user, achievement) pair between snapshot and create, tripping
          // the unique constraint. Use upsert instead of create — it
          // handles both cases atomically inside the transaction.
          if (isUnlocked) {
            const updated = await tx.userAchievement.upsert({
              where: {
                userId_achievementId: { userId, achievementId: achievement.id },
              },
              update: {
                progress: achievement.requirement,
                unlockedAt: new Date(),
              },
              create: {
                userId,
                achievementId: achievement.id,
                progress: achievement.requirement,
              },
              include: { achievement: true },
            });
            // Only count as newly-unlocked when the pre-transaction snapshot
            // had no unlock yet. Re-upserting an already-unlocked row
            // shouldn't emit another "unlocked" event.
            if (!existing || existing.progress < achievement.requirement) {
              newlyUnlocked.push(updated);
            }
          } else if (existing) {
            await tx.userAchievement.update({
              where: { id: existing.id },
              data: { progress },
            });
          } else if (progress > 0) {
            // Only create a progress row when there's something to track —
            // upsert guards against the same race as the unlocked branch.
            await tx.userAchievement.upsert({
              where: {
                userId_achievementId: { userId, achievementId: achievement.id },
              },
              update: { progress },
              create: {
                userId,
                achievementId: achievement.id,
                progress,
              },
            });
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
