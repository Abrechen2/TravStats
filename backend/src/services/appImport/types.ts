/**
 * Other travel apps' exports (forgejo#401): TripIt, Polarsteps, JetLovers,
 * FlightMemory, Logmyflight.
 *
 * Every reader is pure — text in, records out, no database, no network — and
 * puts what it cannot use into `rejects` with a reason CODE, so nothing is
 * dropped silently. The step after (`build.ts`) turns the records into rows of
 * the spreadsheet importer's own sheets, which owns the preview, the dedupe
 * against stored entries and the write rules.
 *
 * FORMAT PROVENANCE. No real export file of these five apps is in the
 * repository. Each reader is written from the app's documented export shape
 * and its fixtures are SYNTHETIC (marked in the file); a header or key a real
 * export spells differently is the likely first defect, which is why the CSV
 * readers take several spellings per column and refuse a file that has none of
 * the key columns (`invalid_file`) instead of importing it as empty.
 */

import type { CheckinRide } from "../checkinImport/types";

export type AppSource = "tripit" | "polarsteps" | "jetlovers" | "flightmemory" | "logmyflight";

export const APP_SOURCES: readonly AppSource[] = [
  "tripit",
  "polarsteps",
  "jetlovers",
  "flightmemory",
  "logmyflight",
];

/** Sheets of the spreadsheet importer an app import can fill. */
export type AppSheetKey =
  | "flights"
  | "lodging"
  | "lodgingStays"
  | "places"
  | "placeVisits"
  | "trips"
  | "rail"
  | "bus"
  /** Records of a kind no importer sheet models (a TripIt car rental, an iCal meeting). */
  | "other";

/** One flight as the source names it; times are the airports' own wall clocks. */
export interface FlightRecord {
  /** 1-based position in the file (CSV: the line a person sees, header = 1). */
  row: number;
  label: string;
  airline?: string;
  flightNumber?: string;
  depIata?: string;
  arrIata?: string;
  /** `YYYY-MM-DDTHH:mm` at the departure airport. */
  depLocal?: string;
  /** `YYYY-MM-DDTHH:mm` at the arrival airport. */
  arrLocal?: string;
  /** The arrival's date was assumed to be the departure's; the zones may move it by days. */
  arrDayGuessed?: boolean;
  /** An absolute moment (iCal `Z` times); wins over the wall clock. */
  depInstant?: Date;
  arrInstant?: Date;
  /** `YYYY-MM-DD` when the source gives a day but no clock. */
  dateOnly?: string;
  aircraft?: string;
  registration?: string;
  seat?: string;
  seatClass?: string;
  category?: string;
  bookingReference?: string;
  notes?: string;
}

/** A trip the source names (Polarsteps): created once, found again by name + days. */
export interface TripRecord {
  row: number;
  label: string;
  name: string;
  /** `YYYY-MM-DD` — the trip's first and last local day, when the source knows them. */
  startDay?: string;
  endDay?: string;
}

/** A row of an importer sheet plus where it came from. */
export interface SheetRecord {
  row: number;
  label: string;
  cells: Record<string, string>;
  /** Non-fatal remark carried to the preview line (a code). */
  note?: string;
}

export interface AppReject {
  sheet: AppSheetKey;
  row: number;
  label: string;
  /** A code, never prose. */
  reason: string;
}

export interface AppParse {
  flights: FlightRecord[];
  /** Rail segments, in the check-in importers' shape (stations resolved later). */
  rides: CheckinRide[];
  trips: TripRecord[];
  lodging: SheetRecord[];
  lodgingStays: SheetRecord[];
  places: SheetRecord[];
  placeVisits: SheetRecord[];
  rejects: AppReject[];
}

export function emptyParse(): AppParse {
  return {
    flights: [],
    rides: [],
    trips: [],
    lodging: [],
    lodgingStays: [],
    places: [],
    placeVisits: [],
    rejects: [],
  };
}

/** Records one file may hold — the spreadsheet importer's per-sheet cap. */
export const MAX_APP_RECORDS = 5000;
