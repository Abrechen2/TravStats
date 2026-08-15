/**
 * Pure statistics rollup for the lodging domain. No I/O, no Prisma.
 *
 * Split across this directory rather than one file: the money and quality
 * blocks each carry enough rules to deserve their own place, and the shapes
 * outgrew the arithmetic. `index.ts` owns the single pass over the stays and
 * hands the per-block computers what they need.
 *
 * What counts is decided in ONE place, `shared/lodgingCounting.ts`: a stay is
 * an actual figure only once its check-out is past, a cancelled stay counts
 * nowhere, and a bookmarked house is not a visit. `now` is injectable so tests
 * can pin the boundary; production always passes the real clock.
 */
import {
  classifyLodging,
  classifyStay,
  type LodgingCountState,
} from "../../shared/lodgingCounting";
import { computeGeoStats } from "./geography";
import { computeLoyaltyStats } from "./loyalty";
import { computePriceStats, type StayWithNights } from "./money";
import { walkNights } from "./nights";
import { computeRatingStats } from "./quality";
import { computeRhythmStats } from "./rhythm";
import type { LodgingRecord, LodgingStats, LodgingStayData } from "./types";

export type {
  LodgingGeoStats,
  LodgingLoyaltyStats,
  LodgingPlace,
  LodgingPlaceCount,
  LodgingPriceGroup,
  LodgingPricedNight,
  LodgingPriceStats,
  LodgingProgrammeYear,
  LodgingRatingGroup,
  LodgingRatingStats,
  LodgingRecord,
  LodgingRhythmStats,
  LodgingStats,
  LodgingStayData,
  LodgingValueStay,
} from "./types";

/**
 * `lodgings` is optional and, when supplied, changes the semantics of
 * `lodgingsCount` and `chainsUnique`: instead of being derived only from
 * stays seen (a hotel with zero stays would otherwise be invisible), they
 * count every lodging the user HAS BEEN TO. Its cities/countries are folded
 * into the shared city/country sets too. Callers that omit `lodgings` keep
 * today's stay-derived behaviour (back-compat).
 */
export function calculateLodgingStats(
  stays: LodgingStayData[],
  currentBaseCurrency = "EUR",
  lodgings?: LodgingRecord[],
  now?: Date,
): LodgingStats {
  // Classify once, up front — every figure below reads the verdict rather than
  // re-deriving it, so "counts as visited" cannot mean two things in one file.
  const stayStates = new Map<LodgingStayData, LodgingCountState>();
  const statesByLodgingId = new Map<string, LodgingCountState[]>();
  for (const s of stays) {
    const state = classifyStay(
      { status: s.status, checkIn: s.checkIn, checkOut: s.checkOut },
      now,
    );
    stayStates.set(s, state);
    const bucket = statesByLodgingId.get(s.lodgingId);
    if (bucket) bucket.push(state);
    else statesByLodgingId.set(s.lodgingId, [state]);
  }

  const activeStays = stays.filter((s) => stayStates.get(s) === "visited");
  const plannedStays = stays.filter((s) => stayStates.get(s) === "planned");

  const lodgingIds = new Set<string>();
  const chainIds = new Set<number>();
  const cities = new Set<string>();
  const countries = new Set<string>();
  const nightsByYear: Record<string, number> = {};
  const nightsByMonth: Record<string, number> = {};
  const spendByCurrency: Record<string, number> = {};
  const spendBaseByCurrency: Record<string, number> = {};
  const nightsByType: Record<string, number> = {};
  const nightsByStars: Record<string, number> = {};
  const nightsByBoard: Record<string, number> = {};
  const lodgingCounts = new Map<string, number>();
  const chainCounts = new Map<number, number>();
  // Nights are walked once here and handed on, so money.ts and quality.ts
  // never re-derive a stay's length and cannot disagree with this file on it.
  const withNights: StayWithNights[] = [];

  let totalNights = 0;
  let longestStayNights = 0;
  let awardNights = 0;
  let spendUnconvertedStays = 0;
  let ratingSum = 0;
  let ratingCount = 0;
  let perfectStays = 0;
  let enduredStays = 0;
  let oneNightStays = 0;

  for (const stay of activeStays) {
    lodgingIds.add(stay.lodgingId);
    if (stay.chainId !== null) chainIds.add(stay.chainId);
    if (stay.city) cities.add(stay.city);
    if (stay.country) countries.add(stay.country);

    lodgingCounts.set(stay.lodgingId, (lodgingCounts.get(stay.lodgingId) ?? 0) + 1);
    if (stay.chainId !== null) {
      chainCounts.set(stay.chainId, (chainCounts.get(stay.chainId) ?? 0) + 1);
    }

    if (stay.currency) {
      const amount = stay.totalPrice ?? 0;
      spendByCurrency[stay.currency] = (spendByCurrency[stay.currency] ?? 0) + amount;
    }
    if (stay.totalPriceBase !== null && stay.fxBaseCurrency !== null) {
      spendBaseByCurrency[stay.fxBaseCurrency] =
        (spendBaseByCurrency[stay.fxBaseCurrency] ?? 0) + stay.totalPriceBase;
    } else if (stay.totalPrice !== null) {
      // Priced, but nothing converted it — the amount exists and is shown on
      // the stay, it just cannot be part of any base-currency sum.
      spendUnconvertedStays += 1;
    }

    if (stay.ratingOverall !== null) {
      ratingSum += stay.ratingOverall;
      ratingCount += 1;
      if (stay.ratingOverall <= 2) enduredStays += 1;
      // All four at 5, none of them blank — see `perfectStays` in types.ts.
      if (
        stay.ratingOverall === 5 &&
        stay.ratingRoom === 5 &&
        stay.ratingBreakfast === 5 &&
        stay.ratingService === 5
      ) {
        perfectStays += 1;
      }
    }

    const stayNights = walkNights(stay.checkIn, stay.checkOut, nightsByYear, nightsByMonth);
    totalNights += stayNights;
    if (stayNights > longestStayNights) longestStayNights = stayNights;
    withNights.push({ stay, nights: stayNights });

    if (stay.isAwardStay) awardNights += stayNights;
    if (stayNights === 1) oneNightStays += 1;
    if (stayNights > 0) {
      nightsByType[stay.type] = (nightsByType[stay.type] ?? 0) + stayNights;
      if (stay.stars !== null) {
        const key = String(stay.stars);
        nightsByStars[key] = (nightsByStars[key] ?? 0) + stayNights;
      }
      if (stay.board) {
        nightsByBoard[stay.board] = (nightsByBoard[stay.board] ?? 0) + stayNights;
      }
    }
  }

  let chainLoyaltyMax = 0;
  for (const count of chainCounts.values()) {
    if (count > chainLoyaltyMax) chainLoyaltyMax = count;
  }
  let sameHotelRepeatMax = 0;
  for (const count of lodgingCounts.values()) {
    if (count > sameHotelRepeatMax) sameHotelRepeatMax = count;
  }

  // Nights that lie ahead. Deliberately walked into a THROWAWAY accumulator:
  // nightsByYear/nightsByMonth describe what happened, and a booking for next
  // June must not appear in the same series as a night actually slept.
  let plannedNights = 0;
  for (const stay of plannedStays) {
    plannedNights += walkNights(stay.checkIn, stay.checkOut, {}, {});
  }

  // When the caller supplies the user's full lodgings list, lodgingsCount/
  // chainsUnique count hotels the user HAS BEEN TO (including ones with no
  // stay recorded — see classifyLodging), and their cities/countries fold
  // into the shared sets too.
  let lodgingsCount = lodgingIds.size;
  let chainsUnique = chainIds.size;
  let plannedLodgingsCount = 0;
  let notedLodgingsCount = 0;
  if (lodgings) {
    const lodgingChainIds = new Set<number>();
    let visitedLodgings = 0;
    for (const l of lodgings) {
      const state = classifyLodging(l, statesByLodgingId.get(l.id) ?? []);
      if (state === "planned") plannedLodgingsCount += 1;
      // `excluded` here can only mean "bookmarked" — a cancelled stay leaves
      // its house countable, the house itself was never cancelled.
      if (state === "excluded") notedLodgingsCount += 1;
      if (state !== "visited") continue;
      visitedLodgings += 1;
      if (l.chainId !== null) lodgingChainIds.add(l.chainId);
      if (l.city) cities.add(l.city);
      if (l.country) countries.add(l.country);
    }
    lodgingsCount = visitedLodgings;
    chainsUnique = lodgingChainIds.size;
  }

  return {
    lodgingsCount,
    staysCount: activeStays.length,
    totalNights,
    nightsByYear,
    nightsByMonth,
    longestStayNights,
    chainsUnique,
    citiesUnique: cities.size,
    countries,
    countriesCount: countries.size,
    spendBaseTotal: spendBaseByCurrency[currentBaseCurrency] ?? 0,
    spendByCurrency,
    spendUnconvertedStays,
    spendBaseByCurrency,
    awardNights,
    nightsByType,
    avgRatingOverall: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
    chainLoyaltyMax,
    sameHotelRepeatMax,
    plannedStaysCount: plannedStays.length,
    plannedNights,
    plannedLodgingsCount,
    notedLodgingsCount,
    nightsByStars,
    nightsByBoard,
    perfectStays,
    enduredStays,
    oneNightStays,
    price: computePriceStats(withNights, currentBaseCurrency, awardNights),
    ratings: computeRatingStats(withNights, currentBaseCurrency),
    geo: computeGeoStats(withNights),
    rhythm: computeRhythmStats(withNights, now ?? new Date()),
    loyalty: computeLoyaltyStats(withNights),
  };
}
