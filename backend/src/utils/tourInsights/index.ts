/**
 * The day-tour insights (forgejo#264): per activity what was done, how far,
 * how high and how long; moving time apart from pauses; personal records;
 * the year and month rhythm with first-time and repeated areas; and what each
 * tour hangs on — a trip, a roadtrip station, a cruise day.
 *
 * Pure. What counts is `shared/tour/tourCounting.ts` (recorded, or dated
 * before today); what a tour measured is `tourFacts.ts`. A guided excursion is
 * a tour activity like any other here — never a bus ride, never driven km.
 */
import { dayPrecisionDate } from "../../services/evidence/entryMappersDomains";
import type { MeasureItem, MeasureItems } from "../../services/stats/insights/measureItems";
import type { TourFacts } from "./tourFacts";

export type { TourFacts } from "./tourFacts";

/** A sum with how many tours it rests on — coverage is part of the figure. */
export interface Covered {
  total: number;
  tours: number;
}

export interface ActivityFigures {
  activity: string;
  completed: number;
  km: Covered;
  ascentM: Covered;
  movingSeconds: Covered;
  pauseSeconds: Covered;
}

export interface TourRecord {
  tourId: string;
  name: string;
  value: number;
  /** For distance: where it was measured. */
  source?: "track" | "route";
}

export interface ActivityRecords {
  activity: string;
  longest: TourRecord | null;
  mostAscent: TourRecord | null;
  highest: TourRecord | null;
}

export interface TourInsights {
  byActivity: ActivityFigures[];
  all: ActivityFigures;
  records: ActivityRecords[];
  rhythm: {
    byYear: Array<{ year: number; tours: number }>;
    byMonth: number[];
    /** Countries in the order they were first reached, each with the tour that did it. */
    firstAreas: Array<{ country: string; day: string | null; tourId: string; name: string }>;
    repeatedAreas: Array<{ country: string; tours: number }>;
    withoutArea: number;
  };
  links: {
    onTrip: number;
    fromRoadtrip: number;
    duringCruise: number;
    standalone: number;
    excursions: { completed: number; km: number; planned: number };
  };
  planned: number;
  undated: number;
  /** Tours whose recording stopped at an import limit — their distance is a lower bound. */
  partial: number;
}

const NO_ACTIVITY = "unknown";

function figures(activity: string, tours: readonly TourFacts[]): ActivityFigures {
  const covered = (pick: (t: TourFacts) => number | null): Covered => {
    const known = tours.map(pick).filter((v): v is number => v !== null);
    return { total: known.reduce((s, v) => s + v, 0), tours: known.length };
  };
  return {
    activity,
    completed: tours.length,
    km: covered((t) => t.km),
    ascentM: covered((t) => t.ascentM),
    movingSeconds: covered((t) => t.movingSeconds),
    pauseSeconds: covered((t) => t.pauseSeconds),
  };
}

function best(
  tours: readonly TourFacts[],
  pick: (t: TourFacts) => number | null,
  withSource = false
): TourRecord | null {
  let top: TourRecord | null = null;
  for (const t of tours) {
    const value = pick(t);
    if (value === null || value <= 0) continue;
    if (!top || value > top.value) {
      top = {
        tourId: t.tour.id,
        name: t.tour.name,
        value,
        ...(withSource && t.kmSource ? { source: t.kmSource } : {}),
      };
    }
  }
  return top;
}

/**
 * What a tour hangs on, as one rule (the "Verknüpfungen" tile, forgejo#264):
 * a trip it is filed on, the roadtrip station it set out from, a cruise of its
 * trip whose days include its day. The three overlap — a shore excursion is on
 * its trip AND during the cruise — so they are never added up; "linked" is a
 * tour with a trip or a roadtrip station, "standalone" one with neither.
 */
const LINKS: Record<string, (t: TourFacts) => boolean> = {
  tourOnTripCount: (t) => t.tour.tripId !== null,
  tourFromRoadtripCount: (t) => t.tour.anchorRoadtripId !== null,
  tourDuringCruiseCount: (t) => t.tour.duringCruise,
  tourLinkedCount: (t) => t.tour.tripId !== null || t.tour.anchorRoadtripId !== null,
  tourStandaloneCount: (t) => t.tour.tripId === null && t.tour.anchorRoadtripId === null,
};

function itemsOf(done: readonly TourFacts[], records: readonly ActivityRecords[]): MeasureItems {
  const item = (t: TourFacts, contribution?: number): MeasureItem => ({
    entry: {
      domain: "roadtrip",
      id: t.tour.id,
      href: `/tours/${t.tour.id}`,
      title: { text: t.tour.name },
      subtitle: null,
      date: dayPrecisionDate(t.day ? new Date(`${t.day}T00:00:00Z`) : null),
    },
    year: t.year,
    contribution,
  });
  return {
    tourCompletedCount: done.map((t) => item(t, 1)),
    tourDistanceKm: done.filter((t) => t.km !== null).map((t) => item(t, t.km as number)),
    tourAscentM: done.filter((t) => t.ascentM !== null).map((t) => item(t, t.ascentM as number)),
    tourMovingMinutes: done
      .filter((t) => t.movingSeconds !== null)
      .map((t) => item(t, (t.movingSeconds as number) / 60)),
    ...Object.fromEntries(
      Object.entries(LINKS).map(([key, linked]) => [
        key,
        done.filter(linked).map((t) => item(t, 1)),
      ])
    ),
    // The country at the tour's first point (the boundary set); the union is
    // the areas toured. A tour without a positioned start credits nothing.
    tourCountriesCount: done
      .filter((t) => t.tour.country !== null)
      .map((t) => ({ ...item(t), credits: [t.tour.country as string] })),
    // The tours holding a personal record — lifetime, like the records.
    tourRecordTours: [...recordHolders(records)].flatMap((id) => {
      const t = done.find((d) => d.tour.id === id);
      return t ? [{ ...item(t, 1), year: null }] : [];
    }),
  };
}

function recordHolders(records: readonly ActivityRecords[]): Set<string> {
  return new Set(
    records.flatMap((r) =>
      [r.longest, r.mostAscent, r.highest].flatMap((rec) => (rec ? [rec.tourId] : []))
    )
  );
}

export function computeTourInsights(facts: readonly TourFacts[]): {
  insights: TourInsights;
  items: MeasureItems;
} {
  const done = facts.filter((f) => f.state === "completed");
  const byActivity = new Map<string, TourFacts[]>();
  for (const t of done) {
    const key = t.tour.activity ?? NO_ACTIVITY;
    byActivity.set(key, [...(byActivity.get(key) ?? []), t]);
  }
  const activities = [...byActivity.entries()].sort(([, a], [, b]) => b.length - a.length);

  const years = new Map<number, number>();
  const byMonth = Array.from({ length: 12 }, () => 0);
  for (const t of done) {
    if (t.year === null || t.day === null) continue;
    years.set(t.year, (years.get(t.year) ?? 0) + 1);
    byMonth[Number(t.day.slice(5, 7)) - 1] += 1;
  }

  // Areas come from the boundary set at the tour's first point — a country,
  // never a place name guessed from the tour's title.
  const ordered = [...done].sort((a, b) => (a.day ?? "9999").localeCompare(b.day ?? "9999"));
  const seen = new Map<string, number>();
  const firstAreas: TourInsights["rhythm"]["firstAreas"] = [];
  for (const t of ordered) {
    const country = t.tour.country;
    if (!country) continue;
    if (!seen.has(country))
      firstAreas.push({ country, day: t.day, tourId: t.tour.id, name: t.tour.name });
    seen.set(country, (seen.get(country) ?? 0) + 1);
  }

  const excursions = facts.filter((f) => f.tour.activity === "excursion");
  const records: ActivityRecords[] = activities.map(([activity, tours]) => ({
    activity,
    longest: best(tours, (t) => t.km, true),
    mostAscent: best(tours, (t) => t.ascentM),
    highest: best(tours, (t) => t.maxElevationM),
  }));
  return {
    insights: {
      byActivity: activities.map(([activity, tours]) => figures(activity, tours)),
      all: figures("all", done),
      records,
      rhythm: {
        byYear: [...years.entries()]
          .sort(([a], [b]) => a - b)
          .map(([year, tours]) => ({ year, tours })),
        byMonth,
        firstAreas,
        repeatedAreas: [...seen.entries()]
          .filter(([, n]) => n >= 2)
          .sort(([, a], [, b]) => b - a)
          .map(([country, tours]) => ({ country, tours })),
        withoutArea: done.filter((t) => !t.tour.country).length,
      },
      links: {
        onTrip: done.filter((t) => t.tour.tripId !== null).length,
        fromRoadtrip: done.filter((t) => t.tour.anchorRoadtripId !== null).length,
        duringCruise: done.filter((t) => t.tour.duringCruise).length,
        standalone: done.filter((t) => t.tour.tripId === null && t.tour.anchorRoadtripId === null)
          .length,
        excursions: {
          completed: excursions.filter((t) => t.state === "completed").length,
          km: excursions
            .filter((t) => t.state === "completed")
            .reduce((s, t) => s + (t.km ?? 0), 0),
          planned: excursions.filter((t) => t.state === "planned").length,
        },
      },
      planned: facts.filter((f) => f.state === "planned").length,
      undated: facts.filter((f) => f.state === "undated").length,
      partial: done.filter((t) => t.partial).length,
    },
    items: itemsOf(done, records),
  };
}
