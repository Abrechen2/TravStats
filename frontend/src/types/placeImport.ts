/**
 * The POI import contract, mirrored from `backend/src/schemas/placeImport.ts`.
 *
 * Kept as a hand-written mirror rather than generated, exactly like
 * `lodgingImport.ts` beside it. The one thing to preserve when editing either
 * side: `lat`/`lon` are OPTIONAL here and required on `Place`. That gap is the
 * feature — a Google Takeout row has a name, the user's note and no coordinates,
 * and it is offered back to them rather than dropped.
 */

export type PlaceImportSource = "csv";

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
  /** `gmaps:<cid>`, `osm:<type>/<id>`, `csv:<user key>` — what makes a re-import a no-op. */
  externalRef?: string | null;
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

export type PlaceImportFailureCode = "invalid_row" | "no_position" | "write_failed";

export interface PlaceImportFailure {
  sourceRowIndex: number;
  code: PlaceImportFailureCode;
  error: string;
}

export interface PlaceImportCommitResult {
  batchId: string;
  created: number;
  skipped: number;
  failed: PlaceImportFailure[];
}
