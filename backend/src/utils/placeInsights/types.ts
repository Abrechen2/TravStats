/** Shapes of the places insights (forgejo#259). The loader is `services/stats/insights/placeInsightData.ts`. */

export interface InsightVisit {
  id: string;
  visitedAt: Date | null;
  visitedAtUtc: Date | null;
  visitedZone: string | null;
  /** minute | day | unknown — or null on a row the time backfill has not reached. */
  visitedPrecision: string | null;
  notes: string | null;
  rating: number | null;
  photoCount: number;
  trip: { id: string; name: string } | null;
}

export interface InsightPlace {
  id: string;
  name: string;
  category: string;
  city: string | null;
  isoCountryCode: string | null;
  lat: number;
  lon: number;
  visited: boolean;
  visits: InsightVisit[];
}

export interface DiscoveryYear {
  year: number;
  /** A place's first dated visit, when nothing undated could be earlier. */
  discoveries: number;
  revisits: number;
  /** Dated visits of a place that also has an undated one — first or not, nobody knows. */
  unordered: number;
}

export interface PlaceGap {
  placeId: string;
  name: string;
  days: number;
  fromVisitId: string;
  toVisitId: string;
  from: string;
  to: string;
}

export interface ReturningPlace {
  placeId: string;
  name: string;
  years: number[];
  visits: number;
}

export interface TripDiversity {
  tripId: string;
  tripName: string;
  year: number | null;
  categories: string[];
}

export interface CityDiversity {
  city: string;
  country: string | null;
  categories: string[];
}

export interface DocumentationYear {
  year: number;
  visits: number;
  withPhoto: number;
  withNote: number;
  withRating: number;
}

export interface PlaceJump {
  km: number;
  from: { visitId: string; placeId: string; name: string; day: string };
  to: { visitId: string; placeId: string; name: string; day: string };
}

export interface PlaceInsights {
  discoveries: {
    byYear: DiscoveryYear[];
    /** Counted places with no dated visit — they have no first day. */
    placesWithoutDatedVisit: number;
    undatedVisits: number;
  };
  revisits: {
    longestGap: PlaceGap | null;
    /** Whole years (calendar anniversaries) of the longest gap — the award's measure. */
    longestGapYears: number;
    returning: ReturningPlace[];
  };
  diversity: {
    trips: TripDiversity[];
    cities: CityDiversity[];
    byYear: Array<{ year: number; categories: string[] }>;
    tripCategoriesMax: number;
    visitsWithoutTrip: number;
  };
  documentation: {
    visits: number;
    withPhoto: number;
    withNote: number;
    withRating: number;
    withNoteAndPhoto: number;
    byYear: DocumentationYear[];
  };
  jump: {
    longest: PlaceJump | null;
    /** Neighbouring visits whose order could not be told apart (same day, no time). */
    uncertainPairs: number;
    /** Counted visits with no date at all — in no sequence. */
    undatedVisits: number;
  };
  plannedVisits: number;
}
