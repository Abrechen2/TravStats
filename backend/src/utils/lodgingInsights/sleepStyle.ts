import type { PreparedStay } from "./prepare";
import type { SleepStyle, SleepStyleYear } from "./types";

/**
 * Hotel, apartment, campsite … per year, by NIGHTS that are actually known
 * (forgejo#258 item 1).
 *
 * A night is filed in the year it STARTS on — the rule every lodging night
 * figure follows (`lodgingStats/nights.ts`). A stay recorded only to the month
 * or year keeps its nights in that year; one with no date at all keeps them in
 * no year (`unplacedNights`). A stay nobody gave a length is left out of every
 * share and counted, so the screen can say how many — a share computed over a
 * silently smaller base is the error this block must not make.
 */
export function computeSleepStyle(counted: readonly PreparedStay[]): SleepStyle {
  const years = new Map<number, Record<string, number>>();
  let unplacedNights = 0;
  let unknownLengthStays = 0;

  const add = (year: number, type: string, nights: number): void => {
    if (nights <= 0) return;
    const bucket = years.get(year) ?? {};
    bucket[type] = (bucket[type] ?? 0) + nights;
    years.set(year, bucket);
  };

  for (const p of counted) {
    if (!p.timing.nightsKnown) {
      unknownLengthStays += 1;
      continue;
    }
    if (p.nightDays.length > 0) {
      for (const day of p.nightDays) add(new Date(day).getUTCFullYear(), p.stay.type, 1);
      continue;
    }
    if (p.year === null) {
      unplacedNights += p.nights;
      continue;
    }
    add(p.year, p.stay.type, p.nights);
  }

  const byYear: SleepStyleYear[] = [...years.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, nightsByType]) => ({
      year,
      nightsByType,
      nights: Object.values(nightsByType).reduce((s, n) => s + n, 0),
    }));
  return { byYear, unplacedNights, unknownLengthStays };
}
