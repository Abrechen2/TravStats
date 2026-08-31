import { z } from "zod";

/**
 * The POI import contract — POI Phase D §5.
 *
 * Modelled on `lodgingImport.ts` deliberately, down to the vocabulary. The
 * lodging import already answers the question this domain was about to ask
 * again: a row the machine cannot finish is `needs_input`, not a silent drop and
 * not a silent create. Its own commit says the rule out loud — "a chain the
 * catalogue does not know is an OFFER, never a silent create … each of those
 * deserves one decision, not an entry."
 */

export const PLACE_IMPORT_SOURCES = ["csv"] as const;
export type PlaceImportSource = (typeof PLACE_IMPORT_SOURCES)[number];

/** Matches `MAX_LODGING_IMPORT_ROWS`. One cap, one number to remember. */
export const MAX_PLACE_IMPORT_ROWS = 1000;

/**
 * Coordinates are OPTIONAL here and required on `Place`.
 *
 * That gap is the whole point of the preview. A Google Takeout row carries a
 * name, a note and a Maps URL and no position at all, so refusing it at the
 * schema would throw away the user's own note to satisfy a column. It is
 * accepted, marked `needs_input`, and offered back to them with the picker —
 * the person knows where "Trattoria da Enzo, best carbonara" is, even when the
 * geocoder does not.
 *
 * The commit is where the invariant is kept: nothing without a position is
 * written, so a `Place` is still always a point.
 */
export const placeImportCandidateSchema = z.object({
  sourceRowIndex: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  visitedAt: z.string().trim().max(40).nullable().optional(),
  /**
   * A namespaced identity from the source: `gmaps:<cid>`, `osm:<type>/<id>`,
   * `csv:<user key>`. It is what makes a second import of the same file a
   * no-op, so it travels from the reader rather than being invented here.
   */
  externalRef: z.string().trim().max(200).nullable().optional(),
});
export type PlaceImportCandidate = z.infer<typeof placeImportCandidateSchema>;

export type PlaceImportFlag = "missing_name" | "missing_coordinates" | "malformed_date";

export type PlaceDedupeHint = "none" | "place_exact_ref" | "place_nearby";

/**
 * `needs_input` is the state this whole design exists for: the row is good, it
 * simply has no position yet, and the user can give it one in a click.
 */
export type PlaceImportAction = "create" | "skip" | "needs_input";

export interface PlaceImportPreviewRow extends PlaceImportCandidate {
  flags: PlaceImportFlag[];
  dedupeHint: PlaceDedupeHint;
  matchedPlaceId: string | null;
  action: PlaceImportAction;
}

export interface PlaceImportSummary {
  /** rows that will create something */
  newRows: number;
  /** rows already here — skipped, which is what makes a re-import a no-op */
  alreadyPresent: number;
  /** rows waiting for the user to place them */
  needsInput: number;
}

export const placeImportPreviewSchema = z.object({
  candidates: z.array(placeImportCandidateSchema).max(MAX_PLACE_IMPORT_ROWS),
});

export const placeImportCommitSchema = z.object({
  source: z.enum(PLACE_IMPORT_SOURCES),
  fileName: z.string().trim().max(255).nullable().optional(),
  rows: z.array(placeImportCandidateSchema).max(MAX_PLACE_IMPORT_ROWS),
});

/**
 * Why one row did not make it. A fixed vocabulary, because the alternative is a
 * raw Prisma message in a 201 body — and a success response never passes
 * through the error handler's leak protections.
 */
export type PlaceImportFailureCode = "invalid_row" | "no_position" | "write_failed";

export const PLACE_IMPORT_FAILURE_MESSAGES: Record<PlaceImportFailureCode, string> = {
  invalid_row: "The row could not be read.",
  no_position: "The row has no coordinates, so it was not imported.",
  write_failed: "The place could not be saved.",
};
