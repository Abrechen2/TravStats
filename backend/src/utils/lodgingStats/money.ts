/**
 * What a night cost. Pure — no I/O, no Prisma.
 *
 * Everything here works in the user's CURRENT base currency and only from the
 * stays whose FX snapshot matches it: the same slice `spendBaseTotal` sums.
 * Mixing in a stay snapshotted under an older base currency would average
 * euros with kroner and produce a number that is wrong without looking wrong,
 * so those land in `unpricedStays` instead.
 */
import type { StayTiming } from "../../shared/lodgingTiming";
import type { LodgingPriceGroup, LodgingPricedNight, LodgingPriceStats, LodgingStayData } from "./types";

export interface StayWithNights {
  stay: LodgingStayData;
  nights: number;
  /** What this stay's dates are good for — see shared/lodgingTiming.ts. */
  timing: StayTiming;
}

/** Money is compared and displayed in cents; carrying more precision invents accuracy. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A stay contributes a per-night price only when all three hold: it was
 * converted, into the CURRENT base currency, and it actually spans a night.
 * A same-day stay has a total but no per-night rate — dividing by zero nights
 * is how an average becomes Infinity.
 */
function perNightPrice(
  entry: StayWithNights,
  currentBaseCurrency: string,
): number | null {
  const { stay, nights } = entry;
  if (nights <= 0) return null;
  if (stay.totalPriceBase === null) return null;
  if (stay.fxBaseCurrency !== currentBaseCurrency) return null;
  return stay.totalPriceBase / nights;
}

interface Accumulator {
  nights: number;
  totalBase: number;
}

function addTo(map: Map<string, Accumulator>, key: string, nights: number, totalBase: number): void {
  const cur = map.get(key);
  if (cur) {
    cur.nights += nights;
    cur.totalBase += totalBase;
  } else {
    map.set(key, { nights, totalBase });
  }
}

/**
 * `byYear` comes back oldest-first because it is read as a trend line;
 * every other list comes back by nights descending, so the categories the
 * user actually sleeps in lead. A screen is free to re-sort — what it must
 * not have to do is guess how many rows there are, hence no truncation here.
 */
function toGroups(map: Map<string, Accumulator>, sort: "key" | "nights"): LodgingPriceGroup[] {
  const groups = [...map.entries()].map(([key, acc]) => ({
    key,
    nights: acc.nights,
    totalBase: round2(acc.totalBase),
    avgPerNight: round2(acc.totalBase / acc.nights),
  }));
  return sort === "key"
    ? groups.sort((a, b) => a.key.localeCompare(b.key))
    : groups.sort((a, b) => b.nights - a.nights || a.key.localeCompare(b.key));
}

function toPricedNight(entry: StayWithNights, pricePerNight: number): LodgingPricedNight {
  return {
    lodgingId: entry.stay.lodgingId,
    lodgingName: entry.stay.lodgingName,
    city: entry.stay.city,
    country: entry.stay.country,
    checkIn: entry.stay.checkIn?.toISOString() ?? null,
    nights: entry.nights,
    pricePerNight: round2(pricePerNight),
  };
}

export function computePriceStats(
  entries: StayWithNights[],
  currentBaseCurrency: string,
  awardNights: number,
): LodgingPriceStats {
  const byYear = new Map<string, Accumulator>();
  const byCountry = new Map<string, Accumulator>();
  const byChain = new Map<string, Accumulator>();
  const byType = new Map<string, Accumulator>();
  const byBoard = new Map<string, Accumulator>();

  // Weighted by nights: the median is over NIGHTS, so a three-week stay pulls
  // as hard as three weeks of one-nighters. A median over stays would let a
  // single cheap airport hotel outvote a month in Tokyo.
  const nightlyPrices: number[] = [];

  let pricedNights = 0;
  let pricedStays = 0;
  let unpricedStays = 0;
  let paidNights = 0;
  let paidTotal = 0;

  let cheapest: LodgingPricedNight | null = null;
  let dearest: LodgingPricedNight | null = null;
  let cheapestValue = Number.POSITIVE_INFINITY;
  let dearestValue = Number.NEGATIVE_INFINITY;

  for (const entry of entries) {
    const price = perNightPrice(entry, currentBaseCurrency);
    if (price === null) {
      // Only a stay that HAS a price but no comparable one is a gap worth
      // reporting. A stay with no price at all was never a money question.
      if (entry.stay.totalPrice !== null) unpricedStays += 1;
      continue;
    }

    const { stay, nights } = entry;
    const total = stay.totalPriceBase!;
    pricedNights += nights;
    pricedStays += 1;
    for (let i = 0; i < nights; i += 1) nightlyPrices.push(price);

    // Award stays are excluded from the paid-rate baseline: a free night at
    // 0 would drag the average down and then value the OTHER award nights
    // against that dragged-down number.
    if (!stay.isAwardStay) {
      paidNights += nights;
      paidTotal += total;
    }

    // An undated stay has no year to sit in. It still counts in the average,
    // the median and the superlatives above — only the year series, which is
    // read as a trend, has nothing honest to do with it.
    if (entry.timing.canBucketByYear && entry.timing.anchor !== null) {
      addTo(byYear, String(entry.timing.anchor.getUTCFullYear()), nights, total);
    }
    if (stay.country) addTo(byCountry, stay.country, nights, total);
    if (stay.chainName) addTo(byChain, stay.chainName, nights, total);
    addTo(byType, stay.type, nights, total);
    if (stay.board) addTo(byBoard, stay.board, nights, total);

    if (price < cheapestValue) {
      cheapestValue = price;
      cheapest = toPricedNight(entry, price);
    }
    if (price > dearestValue) {
      dearestValue = price;
      dearest = toPricedNight(entry, price);
    }
  }

  const avgPaidPerNight = paidNights > 0 ? paidTotal / paidNights : null;

  return {
    avgPricePerNight:
      pricedNights > 0
        ? round2(nightlyPrices.reduce((a, b) => a + b, 0) / nightlyPrices.length)
        : null,
    medianPricePerNight: median(nightlyPrices),
    pricedNights,
    pricedStays,
    unpricedStays,
    cheapestNight: cheapest,
    dearestNight: dearest,
    byYear: toGroups(byYear, "key"),
    byCountry: toGroups(byCountry, "nights"),
    byChain: toGroups(byChain, "nights"),
    byType: toGroups(byType, "nights"),
    byBoard: toGroups(byBoard, "nights"),
    awardNightsValue:
      avgPaidPerNight !== null && awardNights > 0
        ? round2(avgPaidPerNight * awardNights)
        : null,
  };
}

/** Even-length arrays take the mean of the middle pair, the usual convention. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round2(
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid],
  );
}
