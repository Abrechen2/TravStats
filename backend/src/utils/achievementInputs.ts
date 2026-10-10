import { prisma } from "../db";
import { birthdayOf } from "../services/timeModel/readDay";
import { departureClockOf } from "./timezone";
import logger from "./logger";
import {
  calculateUserStats,
  computeFlyAndStayFlags,
  getContinent,
  type FlightData,
  type TripDomainCounts,
  type UserStats,
} from "./achievementStats";
import {
  calculateCruiseStats,
  rangeContainsMonthDay,
  type CruiseData as CruiseStatsInput,
} from "./cruiseStats";
import {
  calculateLodgingStats,
  type LodgingStayData as LodgingStatsInput,
  type LodgingRecord,
} from "./lodgingStats";
import { normalizeCountrySet, unionCountries } from "../shared/countryEvidence";
import { buildMembershipContext, resolveStayProgramme } from "../services/lodging/stayMembership";
import { classifyStay } from "../shared/lodgingCounting";
import { countableFlightWhere } from "../shared/flightCounting";
import { countableCruiseWhere, isCountableCruiseStatus } from "../shared/cruiseCounting";
import { calculatePlaceStats } from "./placeStats";

/**
 * The badge engine's core measures, split in two so they can be asked more
 * than once (forgejo#265): `loadCoreInputs` reads the user's rows, and
 * `computeCoreStats` folds them into `UserStats` WITHOUT touching the
 * database itself — the two lookups it needs from outside (the passport's
 * country set, the cross-domain trip count) arrive as `deps`.
 *
 * The badge check calls them once. The badge evidence
 * (`services/evidence/badges/`) calls `computeCoreStats` again over subsets of
 * the same rows to find the entries a badge's progress stands on — one
 * computation for the badge and for its proof, never a second copy of a rule.
 *
 * Lifted out of `achievements.ts` unchanged apart from those two seams.
 */

/** "Did this flight actually happen" for the per-trip flags — see `achievements.ts`. */
const isDoneStatus = (status: string): boolean => status === "flown" || status === "historical";

export async function loadCoreInputs(userId: string) {
  // Fetch user-level context we need for a few of the new achievements
  // (Birthday Flight needs month+day of birthdate).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { birthdate: true, birthDay: true },
  });

  // Get user's flights (flown+historical for geo/distance stats, all for planner/survivor)
  // + cruises (flown+historical only — a booked-but-not-yet-sailed cruise must not
  //   unlock a cruise achievement any more than a scheduled flight unlocks a flight
  //   one; include stops+ports and trip for Fly & Sail)
  // + lodging stays (all statuses — calculateLodgingStats filters cancelled itself)
  // + per-trip domain counts (flights/cruises/lodgingStays) for the
  //   cross-domain Fly & Stay / Grand Tour flags.
  const [
    flights,
    allFlights,
    cruises,
    lodgingStays,
    lodgings,
    lodgingMemberships,
    trips,
    userSettings,
    places,
  ] = await Promise.all([
    prisma.flight.findMany({
      where: { userId, ...countableFlightWhere() },
      orderBy: { departureTime: "asc" },
    }),
    prisma.flight.findMany({
      where: { userId },
      orderBy: { departureTime: "asc" },
    }),
    prisma.cruise.findMany({
      where: { userId, ...countableCruiseWhere() },
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
        legs: { orderBy: { ordinal: "asc" }, select: { distanceKm: true } },
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
    prisma.loyaltyMembership.findMany({
      where: { userId, domain: "lodging" },
      include: { chains: true, lodgings: true },
    }),
    // Domain rows come back as bare status/date columns, not `_count`s — a
    // DB `where` can express "flown or historical" for flights/cruises, but
    // it cannot express `classifyStay`'s date-derived "visited" for lodging
    // stays, so all three counts get computed in JS below (see
    // `tripDomainCounts`). The fully documented trip is measured with the
    // other cross-domain trip badges (`crossDomainAchievements.ts`).
    prisma.trip.findMany({
      where: { userId },
      select: {
        // Identity for the badge evidence; the measures read the rest.
        id: true,
        name: true,
        startDate: true,
        flights: { select: { status: true } },
        cruises: { select: { status: true } },
        lodgingStays: { select: { status: true, checkIn: true, checkOut: true } },
      },
    }),
    prisma.userSettings.findUnique({ where: { userId }, select: { baseCurrency: true } }),
    // Places with their visits. ALL of them, not only `visited: true` — which
    // ones count is `classifyPlace`'s decision, and asking that question once
    // in SQL and once again in JS is how two answers start to disagree.
    prisma.place.findMany({
      where: { userId },
      select: {
        // Identity for the badge evidence; the measures read the rest.
        id: true,
        name: true,
        visited: true,
        category: true,
        isoCountryCode: true,
        city: true,
        lat: true,
        lon: true,
        curatedItemId: true,
        visits: {
          select: {
            visitedAt: true,
            visitedAtUtc: true,
            visitedZone: true,
            rating: true,
            tripId: true,
          },
        },
      },
    }),
  ]);
  return {
    userId,
    user,
    flights,
    allFlights,
    cruises,
    lodgingStays,
    lodgings,
    lodgingMemberships,
    trips,
    userSettings,
    places,
  };
}

export type CoreInputs = Awaited<ReturnType<typeof loadCoreInputs>>;

export interface CoreDeps {
  /** The badge country set over the union floor — `achievementCountries` in the live check. */
  countries: (unionFloor: ReadonlySet<string>) => Promise<Set<string>>;
  /** The cross-domain fully documented trips (`crossDomainAchievements.ts`). */
  tripsFullyDocumented: number;
  /** "Now" in ms, for the planner measures; defaults to the clock. */
  now?: number;
}

export async function computeCoreStats(
  inputs: CoreInputs,
  deps: CoreDeps
): Promise<{
  stats: UserStats;
  cruiseStatsInput: CruiseStatsInput[];
  userBirthday: ReturnType<typeof birthdayOf>;
}> {
  const {
    user,
    flights,
    allFlights,
    cruises,
    lodgingStays,
    lodgings,
    lodgingMemberships,
    trips,
    userSettings,
    places,
  } = inputs;
  // Same rule as routes/lodging.ts: a stay's FX snapshot is a permanent
  // record of the base currency active WHEN IT WAS SAVED, so the spend-based
  // achievement threshold must only count stays matching the CURRENT base
  // currency — never silently mix currencies together (finding 2).
  const lodgingBaseCurrency = userSettings?.baseCurrency ?? "EUR";

  // Calculate user stats with error handling
  let stats;
  try {
    stats = await calculateUserStats(flights as FlightData[]);
  } catch (error) {
    logger.error({
      operation: "calculate_user_stats",
      message: "Failed to calculate user stats for achievements",
      context: { userId: inputs.userId, flightCount: flights.length },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }

  // Compute planner/survivor stats from all flights (not just flown).
  // Build a fresh `augmentedStats` via spread so the `stats` object
  // returned by `calculateUserStats()` is never mutated.
  const now = deps.now ?? Date.now();
  const scheduled = allFlights.filter((f) => f.status === "scheduled");
  const cancelledCount = allFlights.filter((f) => f.status === "cancelled").length;
  const duplicatedCount = allFlights.filter((f) => f.status === "duplicated").length;

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

  // Birthday Flight — count flown flights that departed on the birthday
  // (year irrelevant), on the departure airport's calendar (ADR 0002 D4).
  let birthdayFlights = stats.birthdayFlights;
  const birthday = birthdayOf(user);
  if (birthday) {
    birthdayFlights = flights.filter((f) => {
      if (f.status !== "flown" || !f.departureTime) return false;
      const clock = departureClockOf(f.departureTime, f);
      return clock.month + 1 === birthday.month && clock.day === birthday.day;
    }).length;
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
  const userBirthday = birthdayOf(user);

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
  const lodgingStats = calculateLodgingStats(
    lodgingStatsInput,
    lodgingBaseCurrency,
    lodgingRecords
  );

  // Birthday / Christmas stays — a day-precise, actually-visited stay whose
  // check-in..check-out range spans the date in question. Month/Year/None
  // precision is excluded: a guessed overlap would be indistinguishable
  // from a known one.
  const dayPreciseVisitedStays = lodgingStays.filter(
    (s) => s.datePrecision === "DAY" && s.checkIn && s.checkOut && classifyStay(s) === "visited"
  );
  const hasLodgingBirthdayStay =
    userBirthday !== undefined &&
    dayPreciseVisitedStays.some((s) =>
      rangeContainsMonthDay(s.checkIn!, s.checkOut!, userBirthday)
    );
  const hasLodgingXmasStay = dayPreciseVisitedStays.some(
    (s) =>
      rangeContainsMonthDay(s.checkIn!, s.checkOut!, { month: 12, day: 24 }) ||
      rangeContainsMonthDay(s.checkIn!, s.checkOut!, { month: 12, day: 25 })
  );

  // Per-trip domain counts, DONE items only (flown/historical flights and
  // cruises, visited lodging stays) — a merely booked leg or a stay that
  // hasn't happened yet must not count toward any cross-domain flag below.
  const doneTrips = trips.map((t) => ({
    flightCount: t.flights.filter((f) => isDoneStatus(f.status)).length,
    cruiseCount: t.cruises.filter((c) => isCountableCruiseStatus(c.status)).length,
    lodgingStayCount: t.lodgingStays.filter((s) => classifyStay(s) === "visited").length,
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
      c.trip.cruises.some((tc) => isCountableCruiseStatus(tc.status))
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
    flightDates.some((fd) => Math.abs(fd.getTime() - cd.getTime()) <= SEVEN_DAYS_MS)
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
  const unionedCountries = unionCountries(combinedCountries, lodgingStats.countries);

  // The badge set counts like the passport (`achievementCountries` in the
  // live check); the union above is its floor.
  const finalCountries = await deps.countries(unionedCountries);

  const augmentedStats: UserStats = {
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
    lodgingFiveStarNights: lodgingStats.nightsByStars["5"] ?? 0,
    lodgingAllInclusiveNights: lodgingStats.nightsByBoard["all_inclusive"] ?? 0,
    lodgingPerfectStays: lodgingStats.perfectStays,
    lodgingEnduredStays: lodgingStats.enduredStays,
    lodgingRatedStays: lodgingStats.ratings.ratedStays,
    lodgingOneNightStays: lodgingStats.oneNightStays,
    lodgingStreakNights: lodgingStats.rhythm.longestStreakNights,
    // Stored 0..1; the requirement is written as a percentage because "25 %
    // of a year away" is the sentence, and 0.25 in a seed file is not.
    lodgingAwaySharePct: Math.round(
      Math.max(0, ...Object.values(lodgingStats.rhythm.awayShareByYear), 0) * 100
    ),
    lodgingIndependentNights: lodgingStats.loyalty.independentNights,
    lodgingProgrammeYearNights: Math.max(
      0,
      ...lodgingStats.loyalty.programmeYears.map((p) => p.nights)
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
    // words and the pictures — the journey by ANY mode since forgejo#265
    // (`crossDomainAchievements.ts`, the one home of the rule).
    // Null when that loader failed: the badge then answers "skip" first.
    tripsFullyDocumented: deps.tripsFullyDocumented,
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

  return { stats: augmentedStats, cruiseStatsInput, userBirthday };
}
