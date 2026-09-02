import { prisma } from '../db';
import logger from './logger';
import {
  applyAchievementWrites,
  planAchievementWrites,
  type UserAchievementWithRelation,
} from './achievementWrites';
import {
  calculateUserStats,
  getContinent,
  type FlightData,
} from './achievementStats';
import {
  calculateCruiseStats,
  rangeContainsMonthDay,
  type CruiseData as CruiseStatsInput,
} from './cruiseStats';
import {
  calculateLodgingStats,
  type LodgingStayData as LodgingStatsInput,
  type LodgingRecord,
} from './lodgingStats';
import {
  computeFlyAndStayFlags,
  normalizeCountrySet,
  unionCountries,
  type TripDomainCounts,
} from './achievementStats';
import {
  buildMembershipContext,
  resolveStayProgramme,
} from '../services/lodging/stayMembership';
import { classifyStay } from '../shared/lodgingCounting';
import { countableFlightWhere } from '../shared/flightCounting';
import { calculatePlaceStats } from './placeStats';

/** Shared "did this actually happen" check for flights and cruises alike —
 * both domains use the same status vocabulary (`flown` / `historical` are
 * done, everything else — scheduled, in_progress, cancelled — is not).
 *
 * Deliberately NOT `isCountableFlightStatus` from shared/flightCounting: this
 * predicate is applied to cruise rows too, and the two domains agree today by
 * coincidence rather than by rule (`duplicated` exists only for flights). A
 * flight-named helper called on a cruise would hide that. If the flight rule
 * ever moves, the cruise half of this line has to be decided separately —
 * which is the whole reason it is written out here rather than imported. */
const isDoneStatus = (status: string): boolean => status === 'flown' || status === 'historical';

// Re-export the shared types so existing callers that imported them from
// `./achievements` keep compiling without touching every import site.
export type { FlightData, UserStats } from './achievementStats';
export { calculateUserStats, getContinent } from './achievementStats';
export { checkAchievement } from './achievementChecks';

/**
 * The re-check currently running or queued for a user, if any.
 *
 * Forgejo #39. A run re-evaluates every achievement inside one long
 * transaction, and ten of the sixteen call sites do not await it — a place tick
 * answers 2xx and leaves the transaction going. Two of those for the same user
 * overlap readily: save a flight while a place tick is still running, or let the
 * six detached call sites in `places.ts` fire in quick succession.
 *
 * The overlap is not theoretical. The suite showed both halves of it — an
 * `upsert` on `(user_id, achievement_id)` failing the unique constraint, and a
 * `40P01 deadlock detected` between two of these transactions. `upsert` is not
 * enough on its own: when the conflicting row belongs to a transaction that has
 * not committed, the second statement blocks and can still fail.
 *
 * So runs for one user are chained end to end. Different users are untouched and
 * still run concurrently — the contention is per user, and so is the fix;
 * serialising everyone would turn one slow account into a queue for the whole
 * instance.
 *
 * The chain is per PROCESS. A deployment running several instances against one
 * database would still overlap; TravStats ships as a single container, so this
 * holds for how it is actually run, and a second instance would need the lock in
 * the database instead. Written down because that limit is invisible from here.
 */
const runningPerUser = new Map<string, Promise<UserAchievementWithRelation[]>>();

/**
 * Check and update achievements for a user
 * Returns newly unlocked achievements
 * Uses transactions to prevent race conditions and ensure data consistency
 *
 * Serialised per user — see `runningPerUser`. A caller still gets its own result
 * and its own rejection; it may simply wait for a run already under way.
 */
export function checkAndUpdateAchievements(userId: string): Promise<UserAchievementWithRelation[]> {
  const previous = runningPerUser.get(userId);

  // Both branches run the check: a failed run must not stop the queue behind it.
  const started: Promise<UserAchievementWithRelation[]> = previous
    ? previous.then(() => runAchievementCheck(userId), () => runAchievementCheck(userId))
    : runAchievementCheck(userId);

  // Only clear the slot if nothing newer has taken it, or a later caller's run
  // would drop out of the chain and could overlap after all.
  const tracked: Promise<UserAchievementWithRelation[]> = started.finally(() => {
    if (runningPerUser.get(userId) === tracked) runningPerUser.delete(userId);
  });

  runningPerUser.set(userId, tracked);
  return tracked;
}

/**
 * Run a re-check as part of the request, and never let it fail the request.
 *
 * Forgejo #39. These ten call sites used to detach: `.catch(...)` and carry on,
 * so the work outlived the response. Two things came of that. The transaction
 * raced whatever else touched the user — a `40P01 deadlock` against a delete —
 * and a re-check could still be writing to rows that had since been removed,
 * which is what `Record to update not found` in the logs was.
 *
 * Shrinking the transaction (see `runningPerUser` above) removed the deadlock,
 * because the run no longer holds locks across the whole catalogue. Awaiting
 * removes the rest: the work cannot outlive the request that caused it. The
 * latency this now adds is small for the same reason — in the ordinary case the
 * plan is empty and no transaction is opened at all.
 *
 * The error is still swallowed rather than raised. The write the user asked for
 * has already succeeded by this point; failing their request because a badge
 * could not be recomputed would be the wrong trade. It stays a log line, and
 * that limit is the part of #39 that remains open: a lost badge appears to the
 * user one save later rather than as an error.
 */
export async function recheckAchievements(userId: string, after: string): Promise<void> {
  try {
    await checkAndUpdateAchievements(userId);
  } catch (error) {
    logger.error(
      { error, userId, context: { after } },
      "[Achievements] Re-check failed"
    );
  }
}

async function runAchievementCheck(userId: string): Promise<UserAchievementWithRelation[]> {
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
    const [flights, allFlights, cruises, lodgingStays, lodgings, lodgingMemberships, trips, userSettings, places] = await Promise.all([
      prisma.flight.findMany({
        where: { userId, ...countableFlightWhere() },
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
          // #269 — without the legs `calculateCruiseStats` falls back to a
          // haversine chord for every leg, so a distance badge unlocked at a
          // different point than the kilometres on the user's own statistics
          // page. The statistics route loads them the same way; both now read
          // the routed (or hand-corrected) length.
          legs: { orderBy: { ordinal: 'asc' }, select: { distanceKm: true } },
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
      // Places with their visits. ALL of them, not only `visited: true` — which
      // ones count is `classifyPlace`'s decision, and asking that question once
      // in SQL and once again in JS is how two answers start to disagree.
      prisma.place.findMany({
        where: { userId },
        select: {
          visited: true,
          category: true,
          isoCountryCode: true,
          city: true,
          lat: true,
          lon: true,
          curatedItemId: true,
          visits: { select: { visitedAt: true, rating: true, tripId: true } },
        },
      }),
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
        // Carried so the achievement input matches what the statistics page
        // sees. No ladder reads `totalPortCalls` today, so nothing changes on
        // screen — but an input that silently differs is how the distance
        // divergence above started.
        unresolvedPortName: s.unresolvedPortName,
      })),
      departurePort: c.departurePort,
      arrivalPort: c.arrivalPort,
      legDistancesKm: c.legs.map((l) => l.distanceKm),
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

    // Birthday / Christmas stays — a day-precise, actually-visited stay whose
    // check-in..check-out range spans the date in question. Month/Year/None
    // precision is excluded: a guessed overlap would be indistinguishable
    // from a known one.
    const dayPreciseVisitedStays = lodgingStays.filter(
      (s) =>
        s.datePrecision === 'DAY' &&
        s.checkIn &&
        s.checkOut &&
        classifyStay(s) === 'visited',
    );
    const hasLodgingBirthdayStay =
      userBirthday !== undefined &&
      dayPreciseVisitedStays.some((s) =>
        rangeContainsMonthDay(s.checkIn!, s.checkOut!, userBirthday),
      );
    const hasLodgingXmasStay = dayPreciseVisitedStays.some(
      (s) =>
        rangeContainsMonthDay(s.checkIn!, s.checkOut!, { month: 12, day: 24 }) ||
        rangeContainsMonthDay(s.checkIn!, s.checkOut!, { month: 12, day: 25 }),
    );

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

    // POI stats. Places carry their own country codes, but they are NOT unioned
    // into the shared `countries` set below: the cross-domain country badges
    // mean "I travelled there", and a place is a pin — a wishlist-free but
    // still very local thing. Mixing them would let a McDonald's around the
    // corner move a travel badge.
    const placeStats = calculatePlaceStats(places);

    // Union flight + cruise + lodging countries into the shared countries Set.
    // Same for continents — map each cruise port to its continent via getContinent().
    // Ports store the country as an English NAME ("Germany"), airports as an ISO-3166
    // alpha-2 code ("DE"), and `Lodging.country` is free text in whatever language the
    // booking mail used ("Deutschland"); getContinent accepts all of them, and
    // `unionCountries` folds them to ONE ISO code each — which is the only reason the
    // country badges can be trusted at all (they counted 88 countries for a passport
    // of 32 while the raw strings were unioned; see `toCountryCode`).
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
      hasCruiseEquatorCrossing: cruiseStats.hasEquatorCrossing,
      cruiseShipLoyaltyMax: cruiseStats.shipLoyaltyMax,
      cruiseInsideCabinCount: cruiseStats.insideCabinCount,
      hasFlyAndSailTrip: flyAndSail,
      hasFlyAndSail7d: flyAndSail7d,
      cruiseCarnivalBrandsCovered: 0, // computed inside the checker
      // Lodging stats
      lodgingsCount: lodgingStats.lodgingsCount,
      lodgingStaysCount: lodgingStats.staysCount,
      lodgingNights: lodgingStats.totalNights,
      lodgingChainsUnique: lodgingStats.chainsUnique,
      // Folded to ISO codes for the same reason as the shared `countries` set:
      // `LodgingStats.countries` holds the free-text column, so "Deutschland"
      // and "Germany" would otherwise be two countries in the lodging badge too.
      lodgingCountries: normalizeCountrySet(lodgingStats.countries),
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
      // Southernmost counterpart — negative latitudes are the interesting ones;
      // the checker flips the sign, so a northern-only traveller yields 0.
      lodgingSouthernmostLat: lodgingStats.geo.southernmost?.lat ?? 0,
      hasLodgingBirthdayStay,
      hasLodgingXmasStay,
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
      // POI — every figure via shared/placeCounting, so a badge and the stats
      // page cannot disagree about whether an undated visit happened.
      placesCount: placeStats.placesCount,
      placeVisitsCount: placeStats.placeVisitsCount,
      placeCountries: placeStats.placeCountries,
      placesInCategoryMax: placeStats.placesInCategoryMax,
      placeCities: placeStats.placeCities,
      placeContinents: placeStats.placeContinents,
      placeCategoriesUnique: placeStats.placeCategoriesUnique,
      placeSameRepeatMax: placeStats.placeSameRepeatMax,
      placesInOneDayMax: placeStats.placesInOneDayMax,
      placeVisitStreakMax: placeStats.placeVisitStreakMax,
      placeVisitsInYearMax: placeStats.placeVisitsInYearMax,
      placeCountriesInYearMax: placeStats.placeCountriesInYearMax,
      placeRatedVisits: placeStats.placeRatedVisits,
      placeTripVisits: placeStats.placeTripVisits,
      placeNorthernLat: placeStats.placeNorthernLat,
      placeSouthernLat: placeStats.placeSouthernLat,
      curatedTickedByList: placeStats.curatedTickedByList,
    };

    // Decide first, write second — the plan is a value that exists before any
    // transaction opens. See `./achievementWrites` for why that ordering is the
    // fix for forgejo#39 and not merely tidier.
    const plan = planAchievementWrites(
      allAchievements,
      existingAchievementMap,
      augmentedStats,
      flights as FlightData[],
    );

    // `return await`, not `return`: a bare return would hand the promise out
    // past the catch below, and a failed write would stop being logged here.
    return await applyAchievementWrites(userId, plan, allAchievements.length);
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
