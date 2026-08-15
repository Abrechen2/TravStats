/**
 * Frontend mirror of `backend/src/services/stats/travelAccount.ts` and
 * `tripAccount.ts`, served together by `GET /stats/travel-account`.
 *
 * Dates cross the wire as ISO strings, never `Date` objects — the same
 * convention as types/lodging.ts.
 */

/**
 * One year's nights, split by where they were spent. The four buckets are
 * mutually exclusive and add up to `days` (the year's length, or the days
 * elapsed so far for the current one).
 */
export interface TravelAccountYear {
  year: string;
  days: number;
  hotelNights: number;
  seaNights: number;
  /** A flight whose departure and arrival fall on different dates. */
  airNights: number;
  homeNights: number;
}

export interface TravelAccount {
  years: TravelAccountYear[];
  /**
   * Nights two domains both claimed — a hotel booked over a night spent at
   * sea, say. The server resolves them (sea beats hotel beats air) but reports
   * the count, because that resolution is a convention and a large number here
   * means the log is wrong somewhere.
   */
  contestedNights: number;
}

export interface TripAccountRow {
  id: string;
  name: string;
  status: string;
  category: string | null;
  /** Null when the trip carries no dates — coverage is then unanswerable. */
  days: number | null;
  coveredDays: number | null;
  /** Days inside the trip with no record of where the night was spent. */
  uncoveredDays: number | null;
  /**
   * Amounts by ORIGINAL currency, never summed across them: only lodging
   * carries an FX snapshot, so one combined figure would mean inventing a rate
   * for flights and cruises at a date nobody recorded.
   */
  spendByCurrency: Record<string, number>;
  /** The lodging slice that has a snapshot, by the base currency it was taken in. */
  spendBaseByCurrency: Record<string, number>;
  journalEntries: number;
  photoCount: number;
}

export interface TripAccount {
  trips: TripAccountRow[];
  tripsWithDates: number;
  fullyCoveredTrips: number;
  totalUncoveredDays: number;
  avgTripDays: number | null;
  longestTripDays: number | null;
  byCategory: { key: string; trips: number; days: number }[];
  byTag: { key: string; trips: number }[];
  moods: { key: string; count: number }[];
  weather: { key: string; count: number }[];
  journalEntries: number;
}

export interface TravelAccountResponse {
  account: TravelAccount;
  trips: TripAccount;
}
