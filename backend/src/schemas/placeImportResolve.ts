import { z } from "./zod";
import { MAX_PLACE_IMPORT_ROWS } from "./placeImport";

/**
 * Resolving a Google Takeout "Saved" list inside the place import (#358).
 *
 * A Takeout list is one CSV per list — `Titel, Notiz, URL` — with no position
 * and no date. Three things can still be read off it, and each is OFFERED in
 * the preview, never written by itself:
 *
 *  1. the position — from the CID in the Maps link (Google Place Details with
 *     the instance's key), else by name inside the list's country (Photon);
 *  2. the trip — a list named after a country maps to the user's ONE trip into
 *     that country; none or several is the user's choice, not a guess;
 *  3. the day — the user's trip photographs within the trip's span and within
 *     a few hundred metres of the place.
 *
 * Plus the kind: a station, a fuel stop, a shop, an airport or a hotel is
 * better as a trip stop (or the stay it already is) than as a place, and a
 * whole city is usually not wanted at all.
 */

export const resolveRowSchema = z.object({
  sourceRowIndex: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(200),
  /** `gmaps:<cid>` or the Maps link itself — the CID is read from either. */
  externalRef: z.string().trim().max(2000).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
});
export type ResolveRow = z.infer<typeof resolveRowSchema>;

export const placeImportResolveSchema = z.object({
  /** The list's name — Takeout names the file after it ("Japan.csv"). */
  listName: z.string().trim().max(200).nullable().optional(),
  rows: z.array(resolveRowSchema).min(1).max(MAX_PLACE_IMPORT_ROWS),
});

/** What kind of thing a saved row is — decides the suggested treatment. */
export const TAKEOUT_KINDS = [
  "sight",
  "station",
  "fuel",
  "shop",
  "airport",
  "lodging",
  "city",
] as const;
export type TakeoutKind = (typeof TAKEOUT_KINDS)[number];

/** What the preview suggests doing with the row. The user decides. */
export const TAKEOUT_TREATMENTS = ["place", "trip_stop", "stay", "skip"] as const;
export type TakeoutTreatment = (typeof TAKEOUT_TREATMENTS)[number];

/**
 * Why no position came from a step. One reason per failure, so the preview can
 * say "the Google key was refused" instead of an empty cell.
 */
export const POSITION_REASONS = [
  /** The row's link carries no CID. */
  "no_cid",
  /** The instance has no Google Places key. */
  "no_key",
  /** Google refused the key (denied, not enabled for the Places API). */
  "auth",
  /** Google's quota or rate limit (429, OVER_QUERY_LIMIT). */
  "quota",
  "timeout",
  "network",
  /** Google answered, but knows no place under that CID. */
  "not_found",
  /** Google answered something unreadable. */
  "provider_error",
  /** The keyless search found nothing inside the list's country. */
  "not_in_country",
  /** The list is not named after a country, so the name search is unbounded. */
  "no_country",
  /** The keyless geocoder could not be reached. */
  "geocoder_unavailable",
  /** More rows than one run asks the keyless geocoder about. */
  "limit_reached",
] as const;
export type PositionReason = (typeof POSITION_REASONS)[number];

export const TRIP_REASONS = ["no_country", "no_trip", "several_trips"] as const;
export type TripReason = (typeof TRIP_REASONS)[number];

export const DAY_REASONS = ["no_trip", "no_position", "no_photos", "ambiguous"] as const;
export type DayReason = (typeof DAY_REASONS)[number];

export interface ResolvedPosition {
  lat: number;
  lon: number;
  source: "google_cid" | "name_search";
  address: string | null;
  city: string | null;
  country: string | null;
}

export interface ResolvedRow {
  sourceRowIndex: number;
  position: ResolvedPosition | null;
  /** Why the CID step gave nothing — kept even when the name search then found it. */
  cidReason: PositionReason | null;
  /** Why the row has no position at all; null when it has one. */
  positionReason: PositionReason | null;
  kind: TakeoutKind;
  suggestedTreatment: TakeoutTreatment;
  visitDay: { date: string; photoCount: number } | null;
  visitDayReason: DayReason | null;
  /** A stay of the trip at this spot — offered as "already your stay". */
  matchedStay: { id: string; name: string; checkIn: string | null } | null;
}

export interface TakeoutTrip {
  id: string;
  name: string;
  first: string | null;
  last: string | null;
}

export interface PlaceImportResolution {
  /** ISO code of the country the list is named after, or null. */
  listCountry: string | null;
  trip: TakeoutTrip | null;
  tripReason: TripReason | null;
  googleConfigured: boolean;
  rows: ResolvedRow[];
}
