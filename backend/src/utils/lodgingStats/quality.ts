/**
 * The user's own verdicts on where they slept. Pure — no I/O, no Prisma.
 *
 * Four rating columns exist per stay (overall, room, breakfast, service) and
 * until now only `overall` was ever averaged. Breakfast in particular is worth
 * its own number: it is the one thing a chain can be reliably good or bad at
 * across countries.
 *
 * Every average here ignores nulls and carries its own denominator. "4.2" from
 * three stays and "4.2" from ninety are different claims, and a screen that
 * cannot tell them apart will present the first as if it were the second.
 */
import type {
  LodgingRatingGroup,
  LodgingRatingStats,
  LodgingStayData,
  LodgingValueStay,
} from "./types";
import type { StayWithNights } from "./money";

/** Ratings are shown to one decimal; more digits imply a precision the 1-5 scale does not have. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface Accumulator {
  sum: number;
  count: number;
}

function addTo(map: Map<string, Accumulator>, key: string, value: number): void {
  const cur = map.get(key);
  if (cur) {
    cur.sum += value;
    cur.count += 1;
  } else {
    map.set(key, { sum: value, count: 1 });
  }
}

/**
 * Sorted by average, best first, ties broken by sample size then key so the
 * order is stable across requests. No truncation — a screen showing "top 5"
 * can slice, but a screen showing "worst chain" needs the tail.
 */
function toGroups(map: Map<string, Accumulator>): LodgingRatingGroup[] {
  return [...map.entries()]
    .map(([key, acc]) => ({
      key,
      stays: acc.count,
      avgOverall: round1(acc.sum / acc.count),
    }))
    .sort((a, b) => b.avgOverall - a.avgOverall || b.stays - a.stays || a.key.localeCompare(b.key));
}

function mean(acc: Accumulator): number | null {
  return acc.count > 0 ? round1(acc.sum / acc.count) : null;
}

/** How many stays fed the best-value list before it is cut. */
const BEST_VALUE_LIMIT = 5;

export function computeRatingStats(
  entries: StayWithNights[],
  currentBaseCurrency: string,
): LodgingRatingStats {
  const overall: Accumulator = { sum: 0, count: 0 };
  const room: Accumulator = { sum: 0, count: 0 };
  const breakfast: Accumulator = { sum: 0, count: 0 };
  const service: Accumulator = { sum: 0, count: 0 };

  const byChain = new Map<string, Accumulator>();
  const byCountry = new Map<string, Accumulator>();
  const byType = new Map<string, Accumulator>();
  const byStars = new Map<string, Accumulator>();

  const valueStays: LodgingValueStay[] = [];
  let unratedStays = 0;

  for (const { stay, nights } of entries) {
    if (stay.ratingRoom !== null) {
      room.sum += stay.ratingRoom;
      room.count += 1;
    }
    if (stay.ratingBreakfast !== null) {
      breakfast.sum += stay.ratingBreakfast;
      breakfast.count += 1;
    }
    if (stay.ratingService !== null) {
      service.sum += stay.ratingService;
      service.count += 1;
    }

    if (stay.ratingOverall === null) {
      // Counted on the OVERALL rating alone: that is the one a screen shows,
      // and a stay rated only on breakfast still leaves the headline blank.
      unratedStays += 1;
      continue;
    }

    overall.sum += stay.ratingOverall;
    overall.count += 1;

    if (stay.chainName) addTo(byChain, stay.chainName, stay.ratingOverall);
    if (stay.country) addTo(byCountry, stay.country, stay.ratingOverall);
    addTo(byType, stay.type, stay.ratingOverall);
    // The star-vs-verdict comparison only means anything where the house
    // HAS an official rating; an unrated guesthouse is not a "0-star".
    if (stay.stars !== null) addTo(byStars, String(stay.stars), stay.ratingOverall);

    const pricePerNight = comparablePricePerNight(stay, nights, currentBaseCurrency);
    if (pricePerNight !== null && pricePerNight > 0) {
      valueStays.push({
        lodgingId: stay.lodgingId,
        lodgingName: stay.lodgingName,
        city: stay.city,
        country: stay.country,
        ratingOverall: stay.ratingOverall,
        pricePerNight: Math.round(pricePerNight * 100) / 100,
        valueScore: Math.round((stay.ratingOverall / pricePerNight) * 10000) / 10000,
      });
    }
  }

  return {
    avgOverall: mean(overall),
    avgRoom: mean(room),
    avgBreakfast: mean(breakfast),
    avgService: mean(service),
    ratedStays: overall.count,
    unratedStays,
    byChain: toGroups(byChain),
    byCountry: toGroups(byCountry),
    byType: toGroups(byType),
    // Star buckets read as a scale ("1" through "5"), not as a ranking —
    // sorting them by average would scramble the axis they are read along.
    byStars: toGroups(byStars).sort((a, b) => a.key.localeCompare(b.key)),
    bestValue: valueStays
      .sort((a, b) => b.valueScore - a.valueScore || a.pricePerNight - b.pricePerNight)
      .slice(0, BEST_VALUE_LIMIT),
  };
}

/** Same three conditions as `money.ts` — converted, current base, at least one night. */
function comparablePricePerNight(
  stay: LodgingStayData,
  nights: number,
  currentBaseCurrency: string,
): number | null {
  if (nights <= 0) return null;
  if (stay.totalPriceBase === null) return null;
  if (stay.fxBaseCurrency !== currentBaseCurrency) return null;
  return stay.totalPriceBase / nights;
}
