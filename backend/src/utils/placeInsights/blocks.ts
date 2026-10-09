import { haversineKm } from "../../shared/geo/haversine";
import type { PreparedVisit } from "./prepare";
import type {
  CityDiversity,
  DiscoveryYear,
  DocumentationYear,
  InsightPlace,
  PlaceGap,
  PlaceInsights,
  PlaceJump,
  ReturningPlace,
  TripDiversity,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function byPlace(visits: readonly PreparedVisit[]): Map<string, PreparedVisit[]> {
  const out = new Map<string, PreparedVisit[]>();
  for (const v of visits) {
    const list = out.get(v.place.id);
    if (list) list.push(v);
    else out.set(v.place.id, [v]);
  }
  return out;
}

function chronological(visits: readonly PreparedVisit[]): PreparedVisit[] {
  return visits
    .filter((v) => v.instant !== null)
    .sort((a, b) => (a.instant as number) - (b.instant as number));
}

/** Whole calendar years from one day to another: 2019-06-10 → 2024-06-09 is 4. */
export function wholeYears(from: string, to: string): number {
  const years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  return to.slice(5) < from.slice(5) ? years - 1 : years;
}

/**
 * First visits against returns, per year (forgejo#259 item 1). A place's FIRST
 * visit is a discovery only when nothing could be earlier: a place that also
 * carries an undated visit may have been found on that one, so its dated
 * visits are `unordered` rather than guessed into either column.
 */
export function computeDiscoveries(
  counted: readonly PreparedVisit[],
  countedPlaces: readonly InsightPlace[]
): PlaceInsights["discoveries"] {
  const years = new Map<number, DiscoveryYear>();
  const row = (year: number): DiscoveryYear => {
    const found = years.get(year) ?? { year, discoveries: 0, revisits: 0, unordered: 0 };
    years.set(year, found);
    return found;
  };
  const grouped = byPlace(counted);
  let undatedVisits = 0;
  for (const visits of grouped.values()) {
    const undated = visits.filter((v) => v.year === null || v.instant === null).length;
    undatedVisits += undated;
    const dated = chronological(visits.filter((v) => v.year !== null));
    dated.forEach((v, i) => {
      const r = row(v.year as number);
      if (undated > 0) r.unordered += 1;
      else if (i === 0) r.discoveries += 1;
      else r.revisits += 1;
    });
  }
  const placesWithoutDatedVisit = countedPlaces.filter(
    (p) => !(grouped.get(p.id) ?? []).some((v) => v.year !== null)
  ).length;
  return {
    byYear: [...years.values()].sort((a, b) => a.year - b.year),
    placesWithoutDatedVisit,
    undatedVisits,
  };
}

/** The longest pause before a return, and the places that keep coming back (item 2). */
export function computeRevisits(counted: readonly PreparedVisit[]): PlaceInsights["revisits"] {
  let longestGap: PlaceGap | null = null;
  const returning: ReturningPlace[] = [];
  for (const visits of byPlace(counted).values()) {
    const place = visits[0].place;
    const years = [...new Set(visits.flatMap((v) => (v.year === null ? [] : [v.year])))].sort(
      (a, b) => a - b
    );
    if (years.length >= 2) {
      returning.push({ placeId: place.id, name: place.name, years, visits: visits.length });
    }
    const days = visits
      .filter((v) => v.day !== null)
      .sort((a, b) => (a.day as string).localeCompare(b.day as string));
    for (let i = 1; i < days.length; i += 1) {
      const from = days[i - 1];
      const to = days[i];
      const gap = Math.round(
        (Date.parse(`${to.day}T00:00:00Z`) - Date.parse(`${from.day}T00:00:00Z`)) / DAY_MS
      );
      if (gap <= 0) continue;
      if (!longestGap || gap > longestGap.days) {
        longestGap = {
          placeId: place.id,
          name: place.name,
          days: gap,
          fromVisitId: from.visit.id,
          toVisitId: to.visit.id,
          from: from.day as string,
          to: to.day as string,
        };
      }
    }
  }
  returning.sort((a, b) => b.years.length - a.years.length || b.visits - a.visits);
  return {
    longestGap,
    longestGapYears: longestGap ? wholeYears(longestGap.from, longestGap.to) : 0,
    returning,
  };
}

/** Categories per trip, per city and per year (item 3). */
export function computeDiversity(
  counted: readonly PreparedVisit[],
  countedPlaces: readonly InsightPlace[]
): PlaceInsights["diversity"] {
  const trips = new Map<string, { name: string; years: number[]; categories: Set<string> }>();
  const years = new Map<number, Set<string>>();
  let visitsWithoutTrip = 0;
  for (const v of counted) {
    if (v.visit.trip) {
      const t = trips.get(v.visit.trip.id) ?? {
        name: v.visit.trip.name,
        years: [],
        categories: new Set<string>(),
      };
      t.categories.add(v.place.category);
      if (v.year !== null) t.years.push(v.year);
      trips.set(v.visit.trip.id, t);
    } else {
      visitsWithoutTrip += 1;
    }
    if (v.year !== null) {
      const set = years.get(v.year) ?? new Set<string>();
      set.add(v.place.category);
      years.set(v.year, set);
    }
  }
  const cities = new Map<string, CityDiversity>();
  for (const p of countedPlaces) {
    if (!p.city) continue;
    const key = `${p.city.trim().toLowerCase()}|${p.isoCountryCode ?? ""}`;
    const c = cities.get(key) ?? { city: p.city.trim(), country: p.isoCountryCode, categories: [] };
    if (!c.categories.includes(p.category)) c.categories.push(p.category);
    cities.set(key, c);
  }
  const tripRows: TripDiversity[] = [...trips.entries()].map(([tripId, t]) => ({
    tripId,
    tripName: t.name,
    year: t.years.length > 0 ? Math.min(...t.years) : null,
    categories: [...t.categories].sort(),
  }));
  tripRows.sort((a, b) => b.categories.length - a.categories.length);
  return {
    trips: tripRows,
    cities: [...cities.values()]
      .map((c) => ({ ...c, categories: [...c.categories].sort() }))
      .sort((a, b) => b.categories.length - a.categories.length)
      .slice(0, 10),
    byYear: [...years.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, set]) => ({ year, categories: [...set].sort() })),
    tripCategoriesMax: Math.max(0, ...tripRows.map((t) => t.categories.length)),
    visitsWithoutTrip,
  };
}

/** Whether a visit carries its own note — whitespace is not a note. */
export function hasNote(v: PreparedVisit): boolean {
  return (v.visit.notes ?? "").trim() !== "";
}

/**
 * Photo, note, rating — each on its own (item 4). Nothing here asks for a
 * rating: an unrated visit is simply not counted as rated, and the screen
 * shows the share, never a nudge.
 */
export function computeDocumentation(
  counted: readonly PreparedVisit[]
): PlaceInsights["documentation"] {
  const years = new Map<number, DocumentationYear>();
  let withPhoto = 0;
  let withNote = 0;
  let withRating = 0;
  let withNoteAndPhoto = 0;
  for (const v of counted) {
    const photo = v.visit.photoCount > 0;
    const note = hasNote(v);
    const rated = v.visit.rating !== null;
    if (photo) withPhoto += 1;
    if (note) withNote += 1;
    if (rated) withRating += 1;
    if (photo && note) withNoteAndPhoto += 1;
    if (v.year === null) continue;
    const y = years.get(v.year) ?? {
      year: v.year,
      visits: 0,
      withPhoto: 0,
      withNote: 0,
      withRating: 0,
    };
    y.visits += 1;
    if (photo) y.withPhoto += 1;
    if (note) y.withNote += 1;
    if (rated) y.withRating += 1;
    years.set(v.year, y);
  }
  return {
    visits: counted.length,
    withPhoto,
    withNote,
    withRating,
    withNoteAndPhoto,
    byYear: [...years.values()].sort((a, b) => a.year - b.year),
  };
}

/**
 * The largest straight-line jump between two visits that follow each other
 * for certain (item 5) — "as the crow flies", never a distance travelled.
 * Two visits on the same day without a time cannot be ordered; that pair is
 * skipped and counted rather than measured in a guessed direction.
 */
export function computeJump(counted: readonly PreparedVisit[]): PlaceInsights["jump"] {
  const ordered = chronological(counted.filter((v) => v.day !== null));
  let longest: PlaceJump | null = null;
  let uncertainPairs = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const a = ordered[i - 1];
    const b = ordered[i];
    if (a.place.id === b.place.id) continue;
    const certain = a.day !== b.day || (a.timed && b.timed);
    if (!certain) {
      uncertainPairs += 1;
      continue;
    }
    const km = haversineKm(a.place, b.place);
    if (!longest || km > longest.km) {
      longest = {
        km: Math.round(km * 10) / 10,
        from: {
          visitId: a.visit.id,
          placeId: a.place.id,
          name: a.place.name,
          day: a.day as string,
        },
        to: { visitId: b.visit.id, placeId: b.place.id, name: b.place.name, day: b.day as string },
      };
    }
  }
  return {
    longest,
    uncertainPairs,
    undatedVisits: counted.filter((v) => v.day === null).length,
  };
}
