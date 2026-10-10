/**
 * The POI import contract, mirrored from `backend/src/schemas/placeImport.ts`.
 *
 * Kept as a hand-written mirror rather than generated, exactly like
 * `lodgingImport.ts` beside it. The one thing to preserve when editing either
 * side: `lat`/`lon` are OPTIONAL here and required on `Place`. That gap is the
 * feature — a Google Takeout row has a name, the user's note and no coordinates,
 * and it is offered back to them rather than dropped.
 */

export type PlaceImportSource = "csv" | "document";

export interface PlaceImportCandidate {
  sourceRowIndex: number;
  name: string;
  lat?: number | null;
  lon?: number | null;
  category?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  notes?: string | null;
  visitedAt?: string | null;
  /** `gmaps-cid:<cid>`, `osm:<type>/<id>`, `csv:<user key>` — what makes a re-import a no-op. */
  externalRef?: string | null;
  /** What the commit makes of the row (#358). Absent = a place. */
  treatment?: "place" | "trip_stop" | "stay";
  /** The trip a dated visit, or a trip stop, belongs to. */
  tripId?: string | null;
  /** The user's own stay a "stay" row is. */
  lodgingStayId?: string | null;
}

export type PlaceImportFlag = "missing_name" | "missing_coordinates" | "malformed_date";

export type PlaceDedupeHint = "none" | "place_exact_ref" | "place_nearby";

/** `needs_input` is a row waiting for the user, not a row that failed. */
export type PlaceImportAction = "create" | "skip" | "needs_input";

export interface PlaceImportPreviewRow extends PlaceImportCandidate {
  flags: PlaceImportFlag[];
  dedupeHint: PlaceDedupeHint;
  matchedPlaceId: string | null;
  action: PlaceImportAction;
}

export interface PlaceImportSummary {
  newRows: number;
  alreadyPresent: number;
  needsInput: number;
}

export interface PlaceImportPreview {
  rows: PlaceImportPreviewRow[];
  summary: PlaceImportSummary;
}

export type PlaceImportFailureCode =
  "invalid_row" | "no_position" | "write_failed" | "invalid_target";

export interface PlaceImportFailure {
  sourceRowIndex: number;
  code: PlaceImportFailureCode;
  error: string;
}

export interface PlaceImportCommitResult {
  batchId: string;
  created: number;
  skipped: number;
  /** Rows written as trip stops (#358). */
  stops: number;
  /** Trip-stop rows skipped: the trip already has that stop on that day. */
  stopsSkipped?: number;
  /** Rows confirmed as one of the user's stays — nothing written for them. */
  matchedStays: number;
  failed: PlaceImportFailure[];
}

/* ── Google Takeout resolution (#358), mirrored from
      `backend/src/schemas/placeImportResolve.ts`. ── */

export type TakeoutKind = "sight" | "station" | "fuel" | "shop" | "airport" | "lodging" | "city";
export type TakeoutTreatment = "place" | "trip_stop" | "stay" | "skip";

export type PositionReason =
  | "no_cid"
  | "no_key"
  | "auth"
  | "quota"
  | "timeout"
  | "network"
  | "not_found"
  | "provider_error"
  | "not_in_country"
  | "no_country"
  | "geocoder_unavailable"
  | "limit_reached";

export type TripReason = "no_country" | "no_trip" | "several_trips";
export type DayReason = "no_trip" | "no_position" | "no_photos" | "ambiguous";

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
  cidReason: PositionReason | null;
  positionReason: PositionReason | null;
  kind: TakeoutKind;
  suggestedTreatment: TakeoutTreatment;
  visitDay: { date: string; photoCount: number } | null;
  visitDayReason: DayReason | null;
  matchedStay: { id: string; name: string; checkIn: string | null } | null;
}

export interface TakeoutTrip {
  id: string;
  name: string;
  first: string | null;
  last: string | null;
}

export interface PlaceImportResolution {
  listCountry: string | null;
  trip: TakeoutTrip | null;
  tripReason: TripReason | null;
  googleConfigured: boolean;
  rows: ResolvedRow[];
}

/** Why a place document produced no candidate (forgejo#124). */
export type PlaceDocumentFallback = "noTemplate" | "notRecognised" | "timedOut";

/** `POST /place-import/document` — at most one candidate, nothing written. */
export interface PlaceDocumentReading {
  candidates: PlaceImportCandidate[];
  templateId: string | null;
  fallbackCode?: PlaceDocumentFallback;
}
