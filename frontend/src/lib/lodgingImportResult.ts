// Shared presentation logic for `LodgingImportCommitResult` (Task 12), used
// by both lodging import entry points (the email/PDF adapter and the CSV
// tile — Task 16). `commitLodgingImport` returns HTTP 201 even on a PARTIAL
// failure (some rows committed, some rejected) — `LodgingImportPreviewModal`
// never sees that result (its `onCommit` prop is `Promise<void>`), so the
// caller is the only place that can present counts honestly. Branching is
// done on `failed[].code` (a small closed union), NEVER on `failed[].error`
// (a diagnostic string, not meant for the user).
//
// Also builds the toast for `LodgingImportRevertResult` (Task 18b), used by
// `ImportLogSection`.

import type { LodgingImportCommitResult, LodgingImportRevertResult } from "../types/lodgingImport";
import type { LodgingRowError } from "./importers/lodgingCsv";

export interface LodgingCommitToast {
  type: "success" | "warning";
  message: string;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Builds the toast to show after a commit. A clean commit (no `failed[]`
 * entries) gets a plain success message; a partial failure gets a `warning`
 * toast naming how many rows succeeded AND how many failed, broken down by
 * failure code so the user isn't just told "something went wrong".
 */
export function describeLodgingCommitResult(
  result: LodgingImportCommitResult,
  t: Translate
): LodgingCommitToast {
  // `result.skipped` MUST reach the user (Task-16 carry-in) — the headline
  // externalRef-dedup feature otherwise reads as a silent "0 hotels, 0 stays
  // imported" on a same-file re-import (every row skipped, nothing failed),
  // with no indication the import worked exactly as designed.
  if (result.failed.length === 0) {
    return {
      type: "success",
      message: t("lodging:import.commitResult.success", {
        createdLodgings: result.createdLodgings,
        createdStays: result.createdStays,
        skipped: result.skipped,
      }),
    };
  }

  const countsByCode = new Map<string, number>();
  for (const failure of result.failed) {
    countsByCode.set(failure.code, (countsByCode.get(failure.code) ?? 0) + 1);
  }
  const reasons = Array.from(countsByCode.entries())
    .map(([code, count]) => `${count}× ${t(`lodging:import.commitResult.failureCodes.${code}`)}`)
    .join(", ");

  return {
    type: "warning",
    message: t("lodging:import.commitResult.partial", {
      createdLodgings: result.createdLodgings,
      createdStays: result.createdStays,
      skipped: result.skipped,
      failedCount: result.failed.length,
      reasons,
    }),
  };
}

/**
 * Turns dropped CSV rows into ONE sentence the user can act on.
 *
 * The dead end this replaces: a stays sheet whose every row failed showed
 * "not a single row of this file could be read" and nothing else — while
 * the actual reason sat unused in `rowErrors`. The user had no way to tell
 * a wrong column mapping from a date format we refuse, so the honest fix is
 * to name the DOMINANT reason, how often it hit, and one offending value.
 *
 * `surviving` decides the tone, not the error count: rows that made it
 * through mean this is a warning about a few skipped rows; zero surviving
 * rows means the import is over before it started and must say so.
 */
export function describeLodgingRowErrors(
  rowErrors: LodgingRowError[],
  surviving: number,
  t: Translate
): string | null {
  if (rowErrors.length === 0) return null;
  if (surviving > 0) return t("lodging:import.errors.skippedRows", { count: rowErrors.length });

  const counts = new Map<string, number>();
  for (const error of rowErrors) counts.set(error.code, (counts.get(error.code) ?? 0) + 1);

  const reason = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => t(`lodging:import.errors.rowReasons.${code}`, { count }))
    .join(", ");

  // The first row carrying a sample — spreadsheet-numbered, so it matches
  // what the user sees in Excel: row 1 is the header, data starts at row 2.
  const withSample = rowErrors.find((e) => e.sample);
  const sample = withSample
    ? t("lodging:import.errors.rowSample", {
        sample: withSample.sample,
        row: withSample.rowIndex + 2,
      })
    : "";

  return t("lodging:import.errors.noRowsReason", { reason: `${reason}${sample}` });
}

/**
 * Builds the toast to show after reverting an import batch (Task 18b). The
 * owner's semantics: a revert deletes only what the batch created — a
 * batch-created lodging that still has foreign stays (added by hand, or
 * attached by a later batch) survives, merely detached from the batch.
 * `detachedLodgings` is what lets this say "kept" instead of silently
 * losing that distinction, so a result with `detachedLodgings > 0` MUST
 * produce a visibly different message than one with 0 — never just the
 * same "deleted" sentence with a hidden zero.
 */
export function describeLodgingRevertResult(
  result: LodgingImportRevertResult,
  t: Translate
): LodgingCommitToast {
  if (result.detachedLodgings > 0) {
    return {
      type: "success",
      message: t("lodging:import.batches.revertResult.withDetached", {
        deletedLodgings: result.deletedLodgings,
        deletedStays: result.deletedStays,
        detachedLodgings: result.detachedLodgings,
      }),
    };
  }

  return {
    type: "success",
    message: t("lodging:import.batches.revertResult.success", {
      deletedLodgings: result.deletedLodgings,
      deletedStays: result.deletedStays,
    }),
  };
}
