/**
 * Wire shapes of `GET /stats/insights/*` (the statistics expansion,
 * forgejo#258/#259/#260/#264). Mirrors `backend/src/schemas/statsInsights/*`;
 * the backend parses its own answer against those schemas in its route tests.
 */

export interface MeasureTotal {
  allTime: number;
  /** A year with nothing has no key — never a 0 standing in for unknown. */
  byYear: Record<string, number>;
}

export type MeasureTotals = Record<string, MeasureTotal>;

export interface LodgingInsights {
  sleepStyle: {
    byYear: Array<{ year: number; nightsByType: Record<string, number>; nights: number }>;
    unplacedNights: number;
    unknownLengthStays: number;
  };
  revisits: {
    houses: Array<{ lodgingId: string; name: string; years: number[]; stays: number }>;
    longestGap: {
      lodgingId: string;
      name: string;
      days: number;
      fromStayId: string;
      toStayId: string;
      from: string;
      to: string;
    } | null;
    sameHouseYearsMax: number;
    returnedHouses: number;
  };
  tripBases: {
    trips: Array<{
      tripId: string;
      tripName: string;
      year: number;
      houses: number;
      changes: number;
      longestBaseNights: number;
      longestBaseLodgingId: string;
      longestBaseName: string;
      overlapNights: number;
      types: string[];
      completed: boolean;
    }>;
    staysWithoutTrip: number;
    undatedTripStays: number;
    typesPerCompletedTripMax: number;
  };
  priceTrends: {
    groups: Array<{
      lodgingId: string;
      name: string;
      roomCategory: string | null;
      board: string | null;
      currency: string;
      stays: number;
      first: { stayId: string; date: string; perNight: number };
      last: { stayId: string; date: string; perNight: number };
      changePct: number;
      thin: boolean;
    }>;
    singlePricedStays: number;
    unpricedStays: number;
    awardStays: number;
    undatedPricedStays: number;
  };
  weekRhythm: {
    byYear: Array<{
      year: number;
      weekendNights: number;
      weekdayNights: number;
      businessNights: number;
      nightsBySeason: Record<string, number>;
    }>;
    weekendNights: number;
    weekdayNights: number;
    businessNights: number;
    unlabelledNights: number;
    notWalkableNights: number;
  };
  calendar: {
    byYear: Array<{ year: number; months: number[] }>;
    fullYears: number[];
    monthsInYearMax: number;
  };
  plannedStays: number;
  totals: MeasureTotals;
}

export interface PlaceInsights {
  discoveries: {
    byYear: Array<{ year: number; discoveries: number; revisits: number; unordered: number }>;
    placesWithoutDatedVisit: number;
    undatedVisits: number;
  };
  revisits: {
    longestGap: {
      placeId: string;
      name: string;
      days: number;
      fromVisitId: string;
      toVisitId: string;
      from: string;
      to: string;
    } | null;
    longestGapYears: number;
    returning: Array<{ placeId: string; name: string; years: number[]; visits: number }>;
  };
  diversity: {
    trips: Array<{ tripId: string; tripName: string; year: number | null; categories: string[] }>;
    cities: Array<{ city: string; country: string | null; categories: string[] }>;
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
    byYear: Array<{
      year: number;
      visits: number;
      withPhoto: number;
      withNote: number;
      withRating: number;
    }>;
  };
  jump: {
    longest: {
      km: number;
      from: { visitId: string; placeId: string; name: string; day: string };
      to: { visitId: string; placeId: string; name: string; day: string };
    } | null;
    uncertainPairs: number;
    undatedVisits: number;
  };
  plannedVisits: number;
  totals: MeasureTotals;
}

export type RoadtripPhase = "past" | "current" | "planned" | "undated";

export interface RoadtripInsightRow {
  id: string;
  name: string;
  year: number | null;
  phase: RoadtripPhase;
  km: { recorded: number; current: number; planned: number; unplaced: number };
  kmBySource: Record<string, number>;
  kmByMode: Record<string, number>;
  nights: { recorded: number; planned: number };
  nightsByStyle: { pitch: number; campsite: number; lodging: number };
  unknownLengthStations: number;
  countries: { recorded: string[]; planned: string[] };
  restDays: number | null;
  tours: { completed: number; km: number; ascentM: number | null };
}

export interface RoadtripInsights {
  roadtrips: RoadtripInsightRow[];
  pace: {
    dayStages: number;
    medianDayKm: number | null;
    longestDay: { roadtripId: string; name: string; day: string; km: number } | null;
    unstagedLegs: number;
    restDays: number;
    fullyDatedTrips: number;
  };
  totals: MeasureTotals;
}

export interface Covered {
  total: number;
  /** How many tours the sum rests on — its coverage. */
  tours: number;
}

export interface TourActivityFigures {
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
  source?: "track" | "route";
}

export interface TourInsights {
  byActivity: TourActivityFigures[];
  all: TourActivityFigures;
  records: Array<{
    activity: string;
    longest: TourRecord | null;
    mostAscent: TourRecord | null;
    highest: TourRecord | null;
  }>;
  rhythm: {
    byYear: Array<{ year: number; tours: number }>;
    byMonth: number[];
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
  partial: number;
  totals: MeasureTotals;
}
