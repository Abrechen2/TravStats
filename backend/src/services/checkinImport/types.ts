/**
 * Check-in app exports (forgejo#401) — the shape every source is read into.
 *
 * Träwelling and travelynx are rail check-in diaries. Their export files are a
 * fixed, documented data format, not a booking mail, so a provider-specific
 * layout in the server is fine here (the "only generic parsers" rule is about
 * mails and PDFs). Parsing is pure: no network, no database. Only the station
 * lookup afterwards (`toSheets.ts`) touches the station catalogue.
 */

export type CheckinSource = "travelling" | "travelynx";

/** The domain sheet a ride is imported through. */
export type CheckinMode = "rail" | "metro" | "tram" | "bus";

/**
 * A clock reading. `wall` is the station's own wall clock (`YYYY-MM-DDTHH:mm`),
 * taken from a timestamp that carries the station's offset or none at all.
 * `instant` is an absolute moment (a `Z` timestamp, an epoch): it can only
 * become a wall clock once the station, and so its zone, is known.
 */
export type CheckinTime = { wall: string } | { instant: Date };

export interface CheckinStop {
  name?: string;
  /** UIC / EVA number when the source carries one. */
  code?: string;
  lat?: number;
  lon?: number;
  time?: CheckinTime;
}

export interface CheckinRide {
  /** 1-based position in the file (CSV: the line a person sees, header = 1). */
  row: number;
  /** Short text for the preview line. */
  label: string;
  /** A source category the importer does not model (ferry, plane, taxi). */
  mode: CheckinMode | { unsupported: string };
  category?: string;
  trainNumber?: string;
  lineName?: string;
  notes?: string;
  dep: CheckinStop;
  arr: CheckinStop;
}

/** A record the reader could not turn into a ride — shown, never dropped. */
export interface CheckinReject {
  row: number;
  label: string;
  /** A code, never prose. */
  reason: string;
}

export interface CheckinParse {
  rides: CheckinRide[];
  rejects: CheckinReject[];
}

/** Records one check-in file may hold — the spreadsheet importer's per-sheet cap. */
export const MAX_CHECKIN_RECORDS = 5000;

/** Thrown while parsing, before any station lookup, when a file holds too many records. */
export class TooManyRecordsError extends Error {
  constructor(public readonly max: number = MAX_CHECKIN_RECORDS) {
    super("too_many_records");
  }
}
