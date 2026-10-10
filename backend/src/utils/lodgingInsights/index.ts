/**
 * The lodging insights (forgejo#258): five readings of the stays the lodging
 * statistics already count, plus the entries behind each figure.
 *
 * Pure — no I/O. What counts is `shared/lodgingCounting.ts` (a stay is a fact
 * once its check-out is past), what its dates are good for
 * `shared/lodgingTiming.ts`, and how its nights fall `lodgingStats/nights.ts`;
 * `prepare.ts` asks all three once. `now` is a parameter so a test can pin the
 * boundary.
 */
import { dayPrecisionDate } from "../../services/evidence/entryMappersDomains";
import type {
  EntryRef,
  MeasureItem,
  MeasureItems,
} from "../../services/stats/insights/measureItems";
import { prepareStays, type PreparedStay } from "./prepare";
import { computeSleepStyle } from "./sleepStyle";
import { computeRevisits } from "./revisits";
import { computeTripBases } from "./tripBases";
import { computePriceTrends } from "./priceTrends";
import { computeCalendar, computeWeekRhythm, isWeekendNight } from "./weekRhythm";
import type { InsightStay, LodgingInsights, PriceTrend, TripBase } from "./types";

export type { InsightStay, LodgingInsights } from "./types";

/** The evidence keys these insights serve (`shared/evidenceMeasuresInsights.ts`). */
export const LODGING_INSIGHT_MEASURES = [
  "lodgingWeekendNights",
  "lodgingWeekdayNights",
  "lodgingBusinessNights",
  "lodgingReturnHouseCount",
  "lodgingSleepStyleNights",
  "lodgingCalendarWeekNights",
  "lodgingCompletedTripBaseCount",
  "lodgingPriceComparisonCount",
  "lodgingCalendarMonthCount",
] as const;

function stayRef(p: PreparedStay): EntryRef {
  return {
    domain: "lodging",
    id: p.stay.id,
    href: `/lodging/${p.stay.lodgingId}`,
    title: { text: p.stay.lodgingName },
    subtitle: p.stay.trip ? { text: p.stay.trip.name } : null,
    date: dayPrecisionDate(p.stay.checkIn),
  };
}

/** One item per stay and year, so a stay over New Year splits honestly. */
function perYear(
  p: PreparedStay,
  countNight: (day: number) => boolean
): Array<{ year: number; nights: number }> {
  const years = new Map<number, number>();
  for (const day of p.nightDays) {
    if (!countNight(day)) continue;
    const year = new Date(day).getUTCFullYear();
    years.set(year, (years.get(year) ?? 0) + 1);
  }
  return [...years.entries()].map(([year, nights]) => ({ year, nights }));
}

/**
 * The nights the sleeping style shares are taken over (`sleepStyle.ts`): a
 * stay with a known length, filed per year by its nights — and only where it
 * HAS a year, because the tile's total is the sum of the years.
 */
function sleepStyleItems(p: PreparedStay, ref: EntryRef): MeasureItem[] {
  if (!p.timing.nightsKnown) return [];
  if (p.nightDays.length > 0) {
    return perYear(p, () => true).map(({ year, nights }) => ({
      entry: ref,
      year,
      contribution: nights,
    }));
  }
  if (p.year === null || p.nights <= 0) return [];
  return [{ entry: ref, year: p.year, contribution: p.nights }];
}

/**
 * The months a stay fills (`computeCalendar`): every month a dated night
 * falls in, or the one month a month-precise stay names; a year-precise stay
 * proves no month. Credited as `YYYY-MM`, so a year's figure is its distinct
 * months.
 */
function calendarItems(p: PreparedStay, ref: EntryRef): MeasureItem[] {
  const byYear = new Map<number, Set<string>>();
  const mark = (at: Date): void => {
    const year = at.getUTCFullYear();
    const set = byYear.get(year) ?? new Set<string>();
    set.add(at.toISOString().slice(0, 7));
    byYear.set(year, set);
  };
  if (p.nightDays.length > 0) {
    for (const day of p.nightDays) mark(new Date(day));
  } else if (p.timing.precision === "MONTH" && p.timing.anchor && p.nights > 0) {
    mark(p.timing.anchor);
  }
  return [...byYear.entries()].map(([year, months]) => ({
    entry: ref,
    year,
    credits: [...months].sort(),
  }));
}

/** A finished trip with dated stays — the trips the median of moves is read over. */
function tripBaseItem(base: TripBase): MeasureItem {
  return {
    entry: {
      domain: "trip",
      id: base.tripId,
      href: `/trips/${base.tripId}`,
      title: { text: base.tripName },
      subtitle: {
        key: "evidence.subtitle.tripBase",
        values: { houses: base.houses, changes: base.changes },
      },
      // The trip's year is all the table files it under (its first dated night).
      date: { value: `${base.year}-01-01`, precision: "year" },
    },
    year: base.year,
    contribution: 1,
  };
}

/** One like-for-like price comparison: a house, its room and board, one currency. */
function priceComparisonItem(group: PriceTrend): MeasureItem {
  const detail = [group.roomCategory, group.board, group.currency].filter(Boolean).join(" · ");
  return {
    entry: {
      domain: "lodging",
      id: [group.lodgingId, group.roomCategory ?? "", group.board ?? "", group.currency].join("|"),
      href: `/lodging/${group.lodgingId}`,
      title: { text: group.name },
      subtitle: { text: detail },
      date: null,
    },
    year: null,
    contribution: 1,
  };
}

function measureItems(
  counted: readonly PreparedStay[],
  trips: readonly TripBase[],
  prices: readonly PriceTrend[]
): MeasureItems {
  const weekend: MeasureItem[] = [];
  const weekday: MeasureItem[] = [];
  const week: MeasureItem[] = [];
  const business: MeasureItem[] = [];
  const sleepStyle: MeasureItem[] = [];
  const calendar: MeasureItem[] = [];
  const houseYears = new Map<string, { ref: PreparedStay; years: Set<number> }>();

  for (const p of counted) {
    const ref = stayRef(p);
    for (const { year, nights } of perYear(p, isWeekendNight)) {
      weekend.push({ entry: ref, year, contribution: nights });
    }
    for (const { year, nights } of perYear(p, (day) => !isWeekendNight(day))) {
      weekday.push({ entry: ref, year, contribution: nights });
    }
    for (const { year, nights } of perYear(p, () => true)) {
      week.push({ entry: ref, year, contribution: nights });
    }
    sleepStyle.push(...sleepStyleItems(p, ref));
    calendar.push(...calendarItems(p, ref));
    if (p.stay.trip?.category === "business" && p.nights > 0) {
      if (p.nightDays.length > 0) {
        for (const { year, nights } of perYear(p, () => true)) {
          business.push({ entry: ref, year, contribution: nights });
        }
      } else {
        business.push({ entry: ref, year: p.year, contribution: p.nights });
      }
    }
    if (p.year !== null) {
      const seen = houseYears.get(p.stay.lodgingId) ?? { ref: p, years: new Set<number>() };
      seen.years.add(p.year);
      houseYears.set(p.stay.lodgingId, seen);
    }
  }

  // A house is evidence of coming back once, whatever its stays: the row is
  // the HOUSE, credited with its own id, and lifetime only — "returned across
  // years" has no meaning inside a single year.
  const returned: MeasureItem[] = [...houseYears.entries()]
    .filter(([, h]) => h.years.size >= 2)
    .map(([lodgingId, h]) => ({
      entry: {
        domain: "lodging",
        id: lodgingId,
        href: `/lodging/${lodgingId}`,
        title: { text: h.ref.stay.lodgingName },
        subtitle: { text: [...h.years].sort((a, b) => a - b).join(" · ") },
        date: null,
      },
      year: null,
      credits: [lodgingId],
      creditLabels: { [lodgingId]: h.ref.stay.lodgingName },
    }));

  return {
    lodgingWeekendNights: weekend,
    lodgingWeekdayNights: weekday,
    lodgingBusinessNights: business,
    lodgingReturnHouseCount: returned,
    lodgingSleepStyleNights: sleepStyle,
    lodgingCalendarWeekNights: week,
    lodgingCompletedTripBaseCount: trips.filter((b) => b.completed).map(tripBaseItem),
    lodgingPriceComparisonCount: prices.map(priceComparisonItem),
    lodgingCalendarMonthCount: calendar,
  };
}

export function computeLodgingInsights(
  stays: readonly InsightStay[],
  now: Date
): { insights: LodgingInsights; items: MeasureItems; plannedStays: number } {
  const prepared = prepareStays(stays, now);
  const counted = prepared.counted;
  const tripBases = computeTripBases(prepared, now);
  const priceTrends = computePriceTrends(counted);
  return {
    insights: {
      sleepStyle: computeSleepStyle(counted),
      revisits: computeRevisits(counted),
      tripBases,
      priceTrends,
      weekRhythm: computeWeekRhythm(counted),
      calendar: computeCalendar(counted),
    },
    items: measureItems(counted, tripBases.trips, priceTrends.groups),
    plannedStays: prepared.planned,
  };
}
