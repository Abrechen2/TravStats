/**
 * The limits a lodging import COMMIT row is held to, for the fields the
 * preview dialog lets the reader edit.
 *
 * MIRRORED byte-for-byte between backend/src/shared and frontend/src/shared;
 * change both together. frontend/src/shared/__tests__/lodgingImportLimits.mirror.test.ts
 * fails when they differ. The backend's Zod schemas (schemas/lodgingImport.ts,
 * schemas/lodging.ts) are built FROM these numbers, and the preview dialog
 * derives its blockers from them — so the commit button cannot be enabled for
 * a row the commit then answers with a 400 for the whole batch (Codex review,
 * 2026-10-25: a 201-character name, a negative price or an 11-year stay all
 * passed the dialog and failed the request).
 *
 * Only the editable fields are listed. Every other field reaches the dialog
 * through the preview request, which validates it with the same field schema
 * the commit uses, and the dialog never changes it.
 */
export const LODGING_IMPORT_LIMITS = {
  /** A house's name, after trimming. Also the cap on a stays-only row's `lodgingName`. */
  nameMaxLength: 200,
  cityMaxLength: 120,
  /** A price may be zero (a voucher night), never negative. */
  minPrice: 0,
  /** The longest checkIn..checkOut span a stay may claim, in nights (~10 years). */
  maxStayNights: 3650,
} as const;
