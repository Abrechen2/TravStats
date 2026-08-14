// Hand-mirrored wire contract for the lodging import pipeline. Mirrors
// backend/src/schemas/lodgingImport.ts and the failure-code union defined in
// backend/src/services/lodging/lodgingImportCommit.ts — kept as a literal
// hand mirror rather than a cross-package import, the same convention
// already used for cruise (types/cruise.ts) and lodging (types/lodging.ts).
//
// A candidate can represent three real shapes: a lodging alone (places-only
// CSV row), a stay alone joining an existing lodging by free-text
// `lodgingName` (stays-only CSV row), or both together (a booking
// confirmation email/PDF). The backend's Zod refinement rejects a stay row
// with neither `lodging` nor `lodgingName` — the frontend only mirrors the
// resulting shape, it does not re-validate it.

import type { BoardType, LodgingCurrency, LodgingType } from "./lodging";

export type LodgingImportSource = "csv" | "email" | "pdf";

export interface LodgingCandidateFields {
  name: string;
  type?: LodgingType | null;
  chainName?: string | null;
  stars?: number | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
  /** "google:<place_id>" — see Lodging.externalRef. */
  externalRef?: string | null;
  notes?: string | null;
  /**
   * Whether the user actually stayed here, or only noted the place down. Absent
   * means visited: every source except a saved-places list describes a real
   * stay, and a missing field must not demote those to bookmarks.
   */
  visited?: boolean;
}

export interface StayCandidateFields {
  /** Calendar day only (YYYY-MM-DD), never an instant. */
  checkIn: string;
  checkOut: string;
  roomCategory?: string | null;
  board?: BoardType | null;
  totalPrice?: number | null;
  currency?: LodgingCurrency | null;
  ratingRoom?: number | null;
  ratingBreakfast?: number | null;
  ratingService?: number | null;
  /** Sent as the source gave it; the backend re-derives it from the components. */
  ratingOverall?: number | null;
  bookingReference?: string | null;
  /** "booking:<confirmation number>" — see LodgingStay.externalRef. */
  externalRef?: string | null;
  notes?: string | null;
}

export interface LodgingImportCandidate {
  sourceRowIndex: number;
  /** null on a stays-only row — the stay joins an existing lodging by `lodgingName`. */
  lodging: LodgingCandidateFields | null;
  /** Free-text hotel name used to join a stays-only row. */
  lodgingName?: string | null;
  stay: StayCandidateFields | null;
}

export type LodgingImportFlag =
  | "missing_name"
  | "unresolvable_lodging_name"
  | "ambiguous_lodging_name"
  | "malformed_date"
  | "invalid_date_range"
  | "missing_coordinates";

export type LodgingDedupeHint =
  "none" | "lodging_exact_ref" | "lodging_name_city" | "stay_exact_ref" | "stay_same_dates";

export type LodgingImportAction = "create" | "skip" | "needs_input";

export interface LodgingImportPreviewRow extends LodgingImportCandidate {
  flags: LodgingImportFlag[];
  dedupeHint: LodgingDedupeHint;
  matchedLodgingId: string | null;
  matchedStayId: string | null;
  action: LodgingImportAction;
}

export interface LodgingImportSummary {
  /** rows that will create something */
  newRows: number;
  /** rows already in the DB — skipped */
  alreadyPresent: number;
  /** rows the user must resolve */
  needsInput: number;
}

// `needs_input` is deliberately NOT accepted on a commit row: the preview
// may produce it, but the user must resolve it into create/skip first —
// see lodgingImportCommitRequestSchema's commitRowSchema on the backend.
export interface LodgingImportCommitRow {
  sourceRowIndex: number;
  action: "create" | "skip";
  matchedLodgingId?: string | null;
  lodging: LodgingCandidateFields | null;
  /** Free-text hotel name used to join a stays-only row against a lodging
   *  ANOTHER row in this same commit payload creates (see
   *  `lodgingImportCommit.ts`'s `createdByName` fallback). */
  lodgingName?: string | null;
  stay: StayCandidateFields | null;
}

/**
 * A small, STABLE set of client-safe failure codes
 * (services/lodging/lodgingImportCommit.ts `LodgingImportRowFailureCode`).
 * `failed[].error` is always one of a fixed set of client-safe strings, never
 * a raw exception message — branch UI behaviour on `code`, not on `error`.
 */
export type LodgingImportRowFailureCode =
  "ownership_mismatch" | "missing_lodging_reference" | "unexpected_error";

export interface LodgingImportCommitResult {
  batchId: string;
  createdLodgings: number;
  createdStays: number;
  skipped: number;
  failed: {
    sourceRowIndex: number;
    code: LodgingImportRowFailureCode;
    error: string;
  }[];
}

export interface LodgingImportBatchSummary {
  id: string;
  source: LodgingImportSource;
  fileName: string | null;
  createdAt: string;
  lodgingCount: number;
  stayCount: number;
}

/**
 * A revert deletes only what the batch created (owner-decided semantics): a
 * batch-created lodging that still has foreign stays (added by hand, or
 * attached by a later batch via `matchedLodgingId`) survives, merely
 * detached from the batch — it is not deleted. `detachedLodgings` is what
 * lets the UI say "3 gelöscht, 1 behalten" instead of silently losing that
 * distinction.
 */
export interface LodgingImportRevertResult {
  deletedLodgings: number;
  deletedStays: number;
  detachedLodgings: number;
}
