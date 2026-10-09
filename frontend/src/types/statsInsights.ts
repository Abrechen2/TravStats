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
