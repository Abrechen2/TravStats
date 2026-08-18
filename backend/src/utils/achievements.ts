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
import {
  calculateLodgingStats,
  type LodgingStayData as LodgingStatsInput,
  type LodgingRecord,
} from './lodgingStats';
import { computeFlyAndStayFlags, unionCountries, type TripDomainCounts } from './achievementStats';
import {
  buildMembershipContext,
  resolveStayProgramme,
} from '../services/lodging/stayMembership';
import { classifyStay } from '../shared/lodgingCounting';

/** Shared "did this actually happen" check for flights and cruises alike —
 * both domains use the same status vocabulary (`flown` / `historical` are
 * done, everything else — scheduled, in_progress, cancelled — is not). */
const isDoneStatus = (status: string): boolean => status === 'flown' || status === 'historical';

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
    // + cruises (flown+historical only — a booked-but-not-yet-sailed cruise must not
    //   unlock a cruise achievement any more than a scheduled flight unlocks a flight
    //   one; include stops+ports and trip for Fly & Sail)
    // + lodging stays (all statuses — calculateLodgingStats filters cancelled itself)
    // + per-trip domain counts (flights/cruises/lodgingStays) for the
    //   cross-domain Fly & Stay / Grand Tour flags.
    const [flights, allFlights, cruises, lodgingStays, lodgings, lodgingMemberships, trips, userSettings] = await Promise.all([
      prisma.flight.findMany({
        where: { userId, status: { in: ['flown', 'historical'] } },
        orderBy: { departureTime: 'asc' },
      }),
      prisma.flight.findMany({
        where: { userId },
        orderBy: { departureTime: 'asc' },
      }),
      prisma.cruise.findMany({
        where: { userId, status: { in: ['flown', 'historical'] } },
        include: {
          stops: { include: { port: true } },
          trip: { include: { flights: true, cruises: true } },
          departurePort: true,
          arrivalPort: true,
        },
      }),
      prisma.lodgingStay.findMany({
        where: { userId },
        include: { lodging: { include: { chain: true } } },
      }),
      // Every lodging the user HAS, including ones with no stay yet — Hotel
      // Collector counts hotels the user added, not only hotels stayed at
      // (owner decision, finding 1).
      prisma.lodging.findMany({ where: { userId } }),
      // Same derivation the stats endpoint uses, so a loyalty achievement and
      // the loyalty figures can never disagree about which card covered a stay.
      prisma.lodgingMembership.findMany({
        where: { userId },
        include: { chains: true, lodgings: true },
      }),
      // Domain rows come back as bare status/date columns, not `_count`s — a
      // DB `where` can express "flown or historical" for flights/cruises, but
      // it cannot express `classifyStay`'s date-derived "visited" for lodging
      // stays, so all three counts get computed in JS below (see
      // `tripDomainCounts` / `tripsFullyDocumented`). journalEntries/photos
      // stay `_count`s — a written entry or an uploaded photo IS done, no
      // status to filter on.
      prisma.trip.findMany({
        where: { userId },
        select: {
          flights: { select: { status: true } },
          cruises: { select: { status: true } },
          lodgingStays: { select: { status: true, checkIn: true, checkOut: true } },
          _count: { select: { journalEntries: true, photos: true } },
        },
      }),
      prisma.userSettings.findUnique({ where: { userId }, select: { baseCurrency: true } }),
    ]);
    // Same rule as routes/lodging.ts: a stay's FX snapshot is a permanent
    // record of the base currency active WHEN IT WAS SAVED, so the spend-based
    // achievement threshold must only count stays matching the CURRENT base
    // currency — never silently mix currencies together (finding 2).
    const lodgingBaseCurrency = userSettings?.baseCurrency ?? 'EUR';

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
      departurePort: c.departurePort,
      arrivalPort: c.arrivalPort,
    }));

    const cruiseStats = calculateCruiseStats(cruiseStatsInput, userBirthday);

    // Lodging stats (multi-domain V1) — computed separately from flight/cruise stats.
    const membershipContext = buildMembershipContext(lodgingMemberships);
    const lodgingStatsInput: LodgingStatsInput[] = lodgingStays.map((s) => {
      const programme = resolveStayProgramme(s, s.lodging.chainId, membershipContext);
      return {
      lodgingId: s.lodgingId,
      lodgingName: s.lodging.name,
      type: s.lodging.type,
      country: s.lodging.country,
      city: s.lodging.city,
      chainId: s.lodging.chainId,
      chainName: s.lodging.chain?.name ?? null,
      stars: s.lodging.stars,
      lat: s.lodging.lat,
      lon: s.lodging.lon,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      datePrecision: s.datePrecision,
      nights: s.nights,
      status: s.status,
      totalPriceBase: s.totalPriceBase,
      fxBaseCurrency: s.fxBaseCurrency,
      currency: s.currency,
      totalPrice: s.totalPrice,
      board: s.board,
      isAwardStay: s.isAwardStay,
      ratingOverall: s.ratingOverall,
      ratingRoom: s.ratingRoom,
      ratingBreakfast: s.ratingBreakfast,
      ratingService: s.ratingService,
      programName: programme.programName,
      membershipTier: programme.tier,
      };
    });
    const lodgingRecords: LodgingRecord[] = lodgings.map((l) => ({
      id: l.id,
      chainId: l.chainId,
      type: l.type,
      country: l.country,
      city: l.city,
      visited: l.visited,
    }));
    const lodgingStats = calculateLodgingStats(lodgingStatsInput, lodgingBaseCurrency, lodgingRecords);

    // Per-trip domain counts, DONE items only (flown/historical flights and
    // cruises, visited lodging stays) — a merely booked leg or a stay that
    // hasn't happened yet must not count toward any cross-domain flag below.
    const doneTrips = trips.map((t) => ({
      flightCount: t.flights.filter((f) => isDoneStatus(f.status)).length,
      cruiseCount: t.cruises.filter((c) => isDoneStatus(c.status)).length,
      lodgingStayCount: t.lodgingStays.filter((s) => classifyStay(s) === 'visited').length,
      journalEntries: t._count.journalEntries,
      photos: t._count.photos,
    }));

    // Fly & Stay / Grand Tour — derived per-trip so a flight in one trip and
    // a stay in an unrelated trip never counts (see computeFlyAndStayFlags).
    const tripDomainCounts: TripDomainCounts[] = doneTrips.map((t) => ({
      flightCount: t.flightCount,
      cruiseCount: t.cruiseCount,
      lodgingStayCount: t.lodgingStayCount,
    }));
    const { flyAndStay, grandTour } = computeFlyAndStayFlags(tripDomainCounts);

    // Fly & Sail — at least one trip contains BOTH a done flight and a done cruise.
    // `cruises` is already filtered to flown/historical, but the sibling rows
    // read off `c.trip.flights` / `c.trip.cruises` (via include) are NOT — they
    // carry every status in that trip, so they need the same done-predicate here.
    const flyAndSail = cruises.some(
      (c) =>
        c.trip &&
        c.trip.flights.some((f) => isDoneStatus(f.status)) &&
        c.trip.cruises.some((tc) => isDoneStatus(tc.status)),
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

    // Union flight + cruise + lodging countries into the shared countries Set.
    // Same for continents — map each cruise port to its continent via getContinent().
    // Ports store the country as an English NAME ("Germany"), airports as an ISO-3166
    // alpha-2 code ("DE"); getContinent accepts both.
    const combinedCountries = new Set<string>(stats.countries);
    const combinedContinents = new Set<string>(stats.continents);
    for (const c of cruiseStatsInput) {
      for (const stop of c.stops) {
        if (stop.port?.country) combinedCountries.add(stop.port.country);
        if (stop.port) {
          const continent = getContinent(stop.port.lat, stop.port.lon, stop.port.country);
          if (continent) combinedContinents.add(continent);
        }
      }
    }
    const finalCountries = unionCountries(combinedCountries, lodgingStats.countries);

    const augmentedStats = {
      ...stats,
      scheduledCount: scheduled.length,
      cancelledCount,
      duplicatedCount,
      scheduledContinents,
      scheduledMaxAdvanceDays,
      birthdayFlights,
      scheduled30d,
      // Countries + continents now include cruise ports + lodging stays for shared achievements
      countries: finalCountries,
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
      // Lodging stats
      lodgingsCount: lodgingStats.lodgingsCount,
      lodgingStaysCount: lodgingStats.staysCount,
      lodgingNights: lodgingStats.totalNights,
      lodgingChainsUnique: lodgingStats.chainsUnique,
      lodgingCountries: lodgingStats.countries,
      lodgingSpendBase: lodgingStats.spendBaseTotal,
      lodgingAwardNights: lodgingStats.awardNights,
      lodgingChainLoyaltyMax: lodgingStats.chainLoyaltyMax,
      lodgingSameHotelRepeatMax: lodgingStats.sameHotelRepeatMax,
      lodgingLongestStayNights: lodgingStats.longestStayNights,
      // Measures added with the 2.7 statistics expansion. All read straight
      // off the same rollup the stats page renders, so a badge and a number on
      // screen can never disagree.
      lodgingTypesUnique: Object.keys(lodgingStats.nightsByType).length,
      lodgingCitiesUnique: lodgingStats.citiesUnique,
      lodgingContinents: lodgingStats.geo.continentsCount,
      lodgingFiveStarNights: lodgingStats.nightsByStars['5'] ?? 0,
      lodgingAllInclusiveNights: lodgingStats.nightsByBoard['all_inclusive'] ?? 0,
      lodgingPerfectStays: lodgingStats.perfectStays,
      lodgingEnduredStays: lodgingStats.enduredStays,
      lodgingRatedStays: lodgingStats.ratings.ratedStays,
      lodgingOneNightStays: lodgingStats.oneNightStays,
      lodgingStreakNights: lodgingStats.rhythm.longestStreakNights,
      // Stored 0..1; the requirement is written as a percentage because "25 %
      // of a year away" is the sentence, and 0.25 in a seed file is not.
      lodgingAwaySharePct: Math.round(
        Math.max(0, ...Object.values(lodgingStats.rhythm.awayShareByYear), 0) * 100,
      ),
      lodgingIndependentNights: lodgingStats.loyalty.independentNights,
      lodgingProgrammeYearNights: Math.max(
        0,
        ...lodgingStats.loyalty.programmeYears.map((p) => p.nights),
      ),
      // Northernmost latitude, floored to whole degrees by the checker. A
      // southern-hemisphere-only traveller yields a negative here, which no
      // requirement can reach — that is the intended outcome, not a bug.
      lodgingNorthernmostLat: lodgingStats.geo.northernmost?.lat ?? 0,
      // A trip is "fully documented" when it records the journey, the bed, the
      // words and the pictures. A cruise counts as the journey too — a
      // flightless cruise trip is not an undocumented one.
      tripsFullyDocumented: doneTrips.filter(
        (t) =>
          t.flightCount + t.cruiseCount > 0 &&
          t.lodgingStayCount > 0 &&
          t.journalEntries > 0 &&
          t.photos > 0,
      ).length,
      // Cross-domain (lodging)
      flyAndStay,
      grandTour,
    };

    // Prepare all updates/creates to execute in a single transaction
    // Use callback-based transaction to prevent race conditions
    const newlyUnlocked: UserAchievementWithRelation[] = [];

    const revoked: string[] = [];

    try {
      await prisma.$transaction(async (tx) => {
        for (const achievement of allAchievements) {
          const existing = existingAchievementMap.get(achievement.id);
          const wasUnlocked = Boolean(
            existing && existing.progress >= achievement.requirement,
          );

          // Every achievement is re-evaluated on every run, unlocked ones included.
          // This used to `continue` on an already-unlocked achievement, which meant a
          // badge granted from data that was later corrected or deleted could never be
          // taken back. It also meant a scoring bug (the Arctic being classified as
          // Antarctica, say) stayed rewarded forever even after the bug was fixed.
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
            // Steady state: the user already holds it and the stored progress is
            // already the requirement. Re-evaluating is cheap (in memory), but writing
            // is not — without this guard every flight save would re-upsert every badge
            // the user has ever earned, adding dozens of pointless writes to a
            // transaction that is already contended.
            if (wasUnlocked && existing && existing.progress === achievement.requirement) {
              continue;
            }

            const updated = await tx.userAchievement.upsert({
              where: {
                userId_achievementId: { userId, achievementId: achievement.id },
              },
              update: {
                progress: achievement.requirement,
                // Keep the ORIGINAL unlock date. Re-checking an achievement the user
                // already holds must not make it look freshly earned — that would
                // reshuffle the trophy case on every flight they add.
                ...(wasUnlocked ? {} : { unlockedAt: new Date() }),
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
            if (!wasUnlocked) {
              newlyUnlocked.push(updated);
            }
          } else if (existing) {
            // Nothing changed — skip the write. (An unlocked badge that is still
            // unlocked never reaches here; this is the progress-row steady state.)
            if (existing.progress === progress) {
              continue;
            }
            if (wasUnlocked) {
              // The user holds this badge but no longer meets its requirement — the
              // flights behind it were deleted, or it was granted by a scoring bug.
              // Writing the true progress drops it back below the threshold, which is
              // what "revoked" means here (there is no separate unlocked flag).
              revoked.push(achievement.code);
            }
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

      if (revoked.length > 0) {
        logger.info({
          operation: 'revoke_achievements',
          message: 'Achievements no longer met their requirement and were revoked',
          context: { userId, codes: revoked },
        });
      }
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
