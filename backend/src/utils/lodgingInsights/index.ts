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
import type { InsightStay, LodgingInsights } from "./types";

export type { InsightStay, LodgingInsights } from "./types";

/** The evidence keys these insights serve (`shared/evidenceMeasuresInsights.ts`). */
export const LODGING_INSIGHT_MEASURES = [
  "lodgingWeekendNights",
  "lodgingWeekdayNights",
  "lodgingBusinessNights",
  "lodgingReturnHouseCount",
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

function measureItems(counted: readonly PreparedStay[]): MeasureItems {
  const weekend: MeasureItem[] = [];
  const weekday: MeasureItem[] = [];
  const business: MeasureItem[] = [];
  const houseYears = new Map<string, { ref: PreparedStay; years: Set<number> }>();

  for (const p of counted) {
    const ref = stayRef(p);
    for (const { year, nights } of perYear(p, isWeekendNight)) {
      weekend.push({ entry: ref, year, contribution: nights });
    }
    for (const { year, nights } of perYear(p, (day) => !isWeekendNight(day))) {
      weekday.push({ entry: ref, year, contribution: nights });
    }
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
  };
}

export function computeLodgingInsights(
  stays: readonly InsightStay[],
  now: Date
): { insights: LodgingInsights; items: MeasureItems; plannedStays: number } {
  const prepared = prepareStays(stays, now);
  const counted = prepared.counted;
  return {
    insights: {
      sleepStyle: computeSleepStyle(counted),
      revisits: computeRevisits(counted),
      tripBases: computeTripBases(prepared, now),
      priceTrends: computePriceTrends(counted),
      weekRhythm: computeWeekRhythm(counted),
      calendar: computeCalendar(counted),
    },
    items: measureItems(counted),
    plannedStays: prepared.planned,
  };
}
