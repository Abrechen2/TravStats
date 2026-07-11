import { z } from "zod";
import { BOARD_TYPES, CURRENCIES, LODGING_TYPES } from "./lodging";

/**
 * Shared import-candidate contract for the lodging import pipeline (see
 * docs/superpowers/specs/2026-07-11-lodging-import-and-location-design.md §3).
 * Two producers — CSV column mapping and the email/PDF parser — both emit
 * `LodgingImportCandidate` rows; one preview and one commit consume them.
 *
 * A candidate can represent three real shapes:
 *  - a lodging alone (places-only CSV row, no stay),
 *  - a stay alone, joining an existing lodging by free-text `lodgingName`
 *    (stays-only CSV row, joined by hotel name),
 *  - both together (a booking confirmation email/PDF).
 * `lodgingImportCandidateSchema.refine` below is what makes the "stay
 * without a lodging reference at all" shape unrepresentable.
 */

export const IMPORT_SOURCES = ["csv", "email", "pdf"] as const;
export type LodgingImportSource = (typeof IMPORT_SOURCES)[number];

export const MAX_LODGING_IMPORT_ROWS = 1000;

/** Calendar day only. The DB column is a DateTime, but an import row carries a
 *  hotel-local calendar day — never an instant — so it stays a plain date here
 *  and is widened to UTC midnight exactly once, at commit time. */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

const rating = z.number().min(1).max(5).nullable().optional();

export const lodgingCandidateFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(LODGING_TYPES).nullable().optional(),
  chainName: z.string().trim().max(120).nullable().optional(),
  stars: z.number().int().min(1).max(5).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  // "google:<place_id>" — see Lodging.externalRef (Task 1).
  externalRef: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type LodgingCandidateFields = z.infer<typeof lodgingCandidateFieldsSchema>;

export const stayCandidateFieldsSchema = z.object({
  checkIn: isoDay,
  checkOut: isoDay,
  roomCategory: z.string().max(120).nullable().optional(),
  board: z.enum(BOARD_TYPES).nullable().optional(),
  // Nullable/optional and deliberately NOT required: a real 380-row import batch
  // (stays joined by hotel name) never carries a price, and that is a valid stay,
  // not a malformed one — it simply never gets an FX snapshot at commit time.
  totalPrice: z.number().min(0).nullable().optional(),
  currency: z.enum(CURRENCIES).nullable().optional(),
  ratingRoom: rating,
  ratingBreakfast: rating,
  ratingOverall: rating,
  bookingReference: z.string().max(40).nullable().optional(),
  // "booking:<confirmation number>" — see LodgingStay.externalRef (Task 1).
  externalRef: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type StayCandidateFields = z.infer<typeof stayCandidateFieldsSchema>;

export const lodgingImportCandidateSchema = z
  .object({
    sourceRowIndex: z.number().int().nonnegative(),
    // null on a stays-only row — the stay joins an existing lodging by `lodgingName`.
    lodging: lodgingCandidateFieldsSchema.nullable(),
    // Free-text hotel name used to join a stays-only row.
    lodgingName: z.string().trim().max(200).nullable().optional(),
    stay: stayCandidateFieldsSchema.nullable(),
  })
  // A row must identify a lodging one way or the other — either it carries the
  // lodging's own fields, or it names one to join against. Neither means the
  // row cannot be attached to anything and would create an orphan stay.
  .refine((c) => c.lodging !== null || !!c.lodgingName, {
    message: "A candidate needs either `lodging` or `lodgingName`",
    path: ["lodgingName"],
  });
export type LodgingImportCandidate = z.infer<typeof lodgingImportCandidateSchema>;

export type LodgingImportFlag =
  | "missing_name"
  | "unresolvable_lodging_name"
  | "ambiguous_lodging_name"
  | "malformed_date"
  | "invalid_date_range"
  | "missing_coordinates";

export type LodgingDedupeHint =
  | "none"
  | "lodging_exact_ref"
  | "lodging_name_city"
  | "stay_exact_ref"
  | "stay_same_dates";

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

export interface LodgingImportBatchSummary {
  id: string;
  source: LodgingImportSource;
  fileName: string | null;
  createdAt: string;
  lodgingCount: number;
  stayCount: number;
}

export const lodgingImportPreviewRequestSchema = z.object({
  candidates: z.array(lodgingImportCandidateSchema).min(1).max(MAX_LODGING_IMPORT_ROWS),
});

// `needs_input` is deliberately NOT accepted here: the preview may produce it,
// but the user has to resolve it into create/skip before a commit is allowed.
// This is the rejected/flagged distinction from the task brief: `needs_input`
// is not a malformed row (it parses fine as a *preview* row), it is simply not
// a valid *commit* action — the schema for the commit boundary rejects it.
export const commitRowSchema = z.object({
  sourceRowIndex: z.number().int().nonnegative(),
  action: z.enum(["create", "skip"]),
  matchedLodgingId: z.string().uuid().nullable().optional(),
  lodging: lodgingCandidateFieldsSchema.nullable(),
  stay: stayCandidateFieldsSchema.nullable(),
});
export type CommitRowInput = z.infer<typeof commitRowSchema>;

export const lodgingImportCommitRequestSchema = z.object({
  source: z.enum(IMPORT_SOURCES),
  fileName: z.string().max(260).nullable(),
  rows: z.array(commitRowSchema).min(1).max(MAX_LODGING_IMPORT_ROWS),
});
export type LodgingImportCommitRequest = z.infer<typeof lodgingImportCommitRequestSchema>;

// Mirrors the `headers` array cap below — a sample row is built FROM those
// headers, so it can never legitimately need more keys than the header list
// allows. Without this, `z.record` caps neither the key COUNT nor the key
// LENGTH, and the whole `sampleRows` array is `JSON.stringify`'d straight
// into the LLM prompt (`mappingSuggestion.ts`) — an attacker could otherwise
// push a multi-MB prompt at the model up to 60 times per 15-minute window.
const MAX_SAMPLE_ROW_KEYS = 80;

const sampleRowSchema = z
  .record(z.string(), z.string().max(500))
  .refine((row) => Object.keys(row).length <= MAX_SAMPLE_ROW_KEYS, {
    message: `A sample row cannot have more than ${MAX_SAMPLE_ROW_KEYS} columns`,
  });

export const suggestMappingRequestSchema = z.object({
  headers: z.array(z.string().max(200)).min(1).max(80),
  sampleRows: z.array(sampleRowSchema).max(5),
});

/** Route param for `DELETE /batches/:id` — the only client-supplied value in
 * this router that used to reach a service function (and a Serializable
 * transaction) unvalidated. */
export const batchIdParamsSchema = z.object({
  id: z.string().uuid(),
});
