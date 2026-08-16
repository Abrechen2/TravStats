import { z } from "zod";
import { BOARD_TYPES, currencyField, LODGING_TYPES } from "./lodging";

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
 *  and is widened to UTC midnight exactly once, at commit time.
 *
 *  The regex alone accepts calendar-impossible days like "2026-02-31" —
 *  `Date.parse` (and therefore `new Date(...)`) silently ROLLS them over
 *  (2026-02-31 becomes 2026-03-03), so a candidate would commit under the
 *  date the user typed but store a different one. The `.refine` below is a
 *  UTC round-trip check that rejects any string which doesn't survive
 *  parse-and-reformat unchanged — it mirrors the frontend's
 *  `isRealCalendarDay` (frontend/src/lib/importers/lodgingCsv.ts). */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine(
    (s) => {
      const t = Date.parse(`${s}T00:00:00.000Z`);
      return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
    },
    { message: "must be a real calendar day" },
  );

const rating = z.number().min(1).max(5).nullable().optional();

export const lodgingCandidateFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(LODGING_TYPES).nullable().optional(),
  chainName: z.string().trim().max(120).nullable().optional(),
  /**
   * Create `chainName` in the catalogue if it is not there yet.
   *
   * Default false, and deliberately so: the commit used to create any unknown
   * chain silently, which fills the catalogue with whatever a parser thought a
   * chain was — spelling variants and all. The preview now surfaces an unknown
   * chain (`unknown_chain`) and the user ticks it once; an unticked row keeps
   * the house chain-less rather than inventing an entry.
   */
  createChain: z.boolean().optional(),
  stars: z.number().int().min(1).max(5).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  // "google:<place_id>" — see Lodging.externalRef (Task 1).
  externalRef: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  /**
   * Whether the user has actually stayed here. Absent means true — every
   * importer that existed before saved-places lists carries real visits, and
   * a missing field must not silently demote them to bookmarks.
   */
  visited: z.boolean().optional(),
});
export type LodgingCandidateFields = z.infer<
  typeof lodgingCandidateFieldsSchema
>;

export const stayCandidateFieldsSchema = z.object({
  checkIn: isoDay,
  checkOut: isoDay,
  roomCategory: z.string().max(120).nullable().optional(),
  board: z.enum(BOARD_TYPES).nullable().optional(),
  // Nullable/optional and deliberately NOT required: a real 380-row import batch
  // (stays joined by hotel name) never carries a price, and that is a valid stay,
  // not a malformed one — it simply never gets an FX snapshot at commit time.
  totalPrice: z.number().min(0).nullable().optional(),
  // Stated by 47 % of real confirmations. Kept alongside the total rather than
  // derived from it: a rate that excludes taxes divided out of a total that
  // includes them is a different number, and the document knows which is which.
  pricePerNight: z.number().min(0).nullable().optional(),
  currency: currencyField.nullable().optional(),
  /**
   * How many people the booking covers. Stored: the count is a fact of the
   * booking, and the stay editor needs it AFTER the import to point at the
   * companions field. What is not stored is WHO came along — a confirmation
   * names the booker, never the companion, so that stays the user's to enter.
   */
  guests: z.number().int().min(1).max(20).nullable().optional(),
  ratingRoom: rating,
  ratingBreakfast: rating,
  ratingService: rating,
  // Accepted, but never stored as sent: `createStay` re-derives the overall
  // from the three components and only falls back to this value for a stay
  // that carries none of them (shared/ratingDerivation.ts).
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
export type LodgingImportCandidate = z.infer<
  typeof lodgingImportCandidateSchema
>;

export type LodgingImportFlag =
  | "missing_name"
  | "unresolvable_lodging_name"
  | "ambiguous_lodging_name"
  | "malformed_date"
  | "invalid_date_range"
  | "missing_coordinates"
  | "unknown_chain";

export type LodgingDedupeHint =
  | "none"
  | "lodging_exact_ref"
  | "lodging_name_city"
  | "lodging_nearby"
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
  candidates: z
    .array(lodgingImportCandidateSchema)
    .min(1)
    .max(MAX_LODGING_IMPORT_ROWS),
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
  // Free-text hotel name for an UNEDITED stays-only row the preview matched
  // by name against another candidate in the SAME payload (`lodging` stays
  // null there — see lodgingImportPreview.ts's `payloadNames` branch). The
  // commit service resolves it against that other row's `createdByName`
  // entry; if it resolves nothing the row fails `missing_lodging_reference`
  // exactly as before this field existed.
  lodgingName: z.string().trim().max(200).nullable().optional(),
  stay: stayCandidateFieldsSchema.nullable(),
});
export type CommitRowInput = z.infer<typeof commitRowSchema>;

export const lodgingImportCommitRequestSchema = z.object({
  source: z.enum(IMPORT_SOURCES),
  fileName: z.string().max(260).nullable(),
  rows: z.array(commitRowSchema).min(1).max(MAX_LODGING_IMPORT_ROWS),
});
export type LodgingImportCommitRequest = z.infer<
  typeof lodgingImportCommitRequestSchema
>;

// Mirrors the `headers` array cap below — a sample row is built FROM those
// headers, so it can never legitimately need more keys than the header list
// allows. Both the key COUNT and the key LENGTH are capped (mirroring the
// 500-char value cap) — otherwise `z.record`'s bare `z.string()` key schema
// would let each of the up to 80 keys be arbitrarily long, and the whole
// `sampleRows` array is `JSON.stringify`'d straight into the LLM prompt
// (`mappingSuggestion.ts`) — an attacker could otherwise push a multi-MB
// prompt at the model up to 60 times per 15-minute window.
const MAX_SAMPLE_ROW_KEYS = 80;

const sampleRowSchema = z
  .record(z.string().max(500), z.string().max(500))
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
