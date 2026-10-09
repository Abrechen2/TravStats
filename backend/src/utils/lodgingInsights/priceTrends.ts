import type { PreparedStay } from "./prepare";
import type { PricePoint, PriceTrend, PriceTrends } from "./types";

/** Below this many priced stays a group is marked thin, not hidden. */
const THIN_BELOW = 3;

function normalized(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed === "" ? null : trimmed;
}

function dateLabel(p: PreparedStay): string {
  const iso = p.timing.anchor!.toISOString();
  if (p.timing.precision === "YEAR") return iso.slice(0, 4);
  if (p.timing.precision === "MONTH") return iso.slice(0, 7);
  return iso.slice(0, 10);
}

/**
 * The same house, the same kind of room and board, the same currency — how
 * the price per night moved (forgejo#258 item 4).
 *
 * Four rules keep this from being a number nobody should believe:
 *  - CURRENCIES ARE NEVER MIXED. A group is one currency; 120 CHF and 110 EUR
 *    at one hotel are two groups, not a 9 % drop.
 *  - A night price needs a known length: total ÷ nights, never total ÷ a guess.
 *  - An award stay is not a price of 0 — it is left out and counted.
 *  - A group of two is shown and marked thin; it is a comparison, not a trend.
 * Room and board are matched as written (case and spacing folded). Where the
 * user recorded neither, the group says so instead of pretending the rooms
 * were alike.
 */
export function computePriceTrends(counted: readonly PreparedStay[]): PriceTrends {
  const groups = new Map<string, { sample: PreparedStay; points: PricePoint[] }>();
  let unpricedStays = 0;
  let awardStays = 0;
  let undatedPricedStays = 0;

  for (const p of counted) {
    if (p.stay.isAwardStay) {
      awardStays += 1;
      continue;
    }
    // A price of 0 without points is a free night at a friend's, not a rate.
    if (
      p.stay.totalPrice === null ||
      p.stay.totalPrice <= 0 ||
      !p.timing.nightsKnown ||
      p.nights <= 0
    ) {
      unpricedStays += 1;
      continue;
    }
    if (p.timing.anchor === null) {
      undatedPricedStays += 1;
      continue;
    }
    const key = [
      p.stay.lodgingId,
      normalized(p.stay.roomCategory) ?? "",
      normalized(p.stay.board) ?? "",
      p.stay.currency.toUpperCase(),
    ].join("\u0000");
    const group = groups.get(key) ?? { sample: p, points: [] };
    group.points.push({
      stayId: p.stay.id,
      date: dateLabel(p),
      perNight: p.stay.totalPrice / p.nights,
    });
    groups.set(key, group);
  }

  const trends: PriceTrend[] = [];
  let singlePricedStays = 0;
  for (const { sample, points } of groups.values()) {
    if (points.length < 2) {
      singlePricedStays += points.length;
      continue;
    }
    const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    trends.push({
      lodgingId: sample.stay.lodgingId,
      name: sample.stay.lodgingName,
      roomCategory: sample.stay.roomCategory?.trim() || null,
      board: sample.stay.board?.trim() || null,
      currency: sample.stay.currency.toUpperCase(),
      stays: points.length,
      first: { ...first, perNight: Math.round(first.perNight * 100) / 100 },
      last: { ...last, perNight: Math.round(last.perNight * 100) / 100 },
      changePct: Math.round(((last.perNight - first.perNight) / first.perNight) * 1000) / 10,
      thin: points.length < THIN_BELOW,
    });
  }
  trends.sort((a, b) => b.stays - a.stays || Math.abs(b.changePct) - Math.abs(a.changePct));
  return { groups: trends, singlePricedStays, unpricedStays, awardStays, undatedPricedStays };
}
