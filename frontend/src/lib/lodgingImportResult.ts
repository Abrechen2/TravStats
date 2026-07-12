// Shared presentation logic for `LodgingImportCommitResult` (Task 12), used
// by both lodging import entry points (the email/PDF adapter and the CSV
// tile — Task 16). `commitLodgingImport` returns HTTP 201 even on a PARTIAL
// failure (some rows committed, some rejected) — `LodgingImportPreviewModal`
// never sees that result (its `onCommit` prop is `Promise<void>`), so the
// caller is the only place that can present counts honestly. Branching is
// done on `failed[].code` (a small closed union), NEVER on `failed[].error`
// (a diagnostic string, not meant for the user).

import type { LodgingImportCommitResult } from "../types/lodgingImport";

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
  if (result.failed.length === 0) {
    return {
      type: "success",
      message: t("lodging:import.commitResult.success", {
        createdLodgings: result.createdLodgings,
        createdStays: result.createdStays,
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
      failedCount: result.failed.length,
      reasons,
    }),
  };
}
