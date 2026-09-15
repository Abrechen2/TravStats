// Presentation of a `PlaceImportCommitResult`, used by the CSV tile — the one
// place that sees the commit answer. `commitPlaceImport` returns 201 even on a
// PARTIAL failure (some rows written, some rejected), and the preview modal
// never sees that result, so the caller is the only one who can present the
// counts honestly. Branching is on `failed[].code` (a small closed union),
// NEVER on `failed[].error` (a diagnostic string, not meant for the user).

import type { PlaceImportCommitResult } from "../types/placeImport";
import type { PlaceCsvRowError } from "./importers/placeCsv";

export interface PlaceCommitToast {
  type: "success" | "warning";
  message: string;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * A clean commit gets a plain success line; a partial one a warning that names
 * how many rows made it AND how many did not, by reason — "something went
 * wrong" is not an answer anyone can act on.
 *
 * `skipped` always reaches the user: it is the externalRef dedupe doing its
 * job, and a same-file re-import that reads "0 places created" with no mention
 * of it looks broken while working exactly as designed.
 */
export function describePlaceCommitResult(
  result: PlaceImportCommitResult,
  t: Translate
): PlaceCommitToast {
  if (result.failed.length === 0) {
    return {
      type: "success",
      message: t("places:import.commitResult.success", {
        created: result.created,
        skipped: result.skipped,
      }),
    };
  }

  const countsByCode = new Map<string, number>();
  for (const failure of result.failed) {
    countsByCode.set(failure.code, (countsByCode.get(failure.code) ?? 0) + 1);
  }
  const reasons = Array.from(countsByCode.entries())
    .map(([code, count]) => `${count}× ${t(`places:import.commitResult.failureCodes.${code}`)}`)
    .join(", ");

  return {
    type: "warning",
    message: t("places:import.commitResult.partial", {
      created: result.created,
      skipped: result.skipped,
      failed: result.failed.length,
      reasons,
    }),
  };
}

/**
 * Dropped CSV rows as ONE sentence. The only reason a row is dropped before the
 * preview is a missing name (`buildPlaceCandidates`) — everything else, a row
 * without coordinates included, goes through to be offered to the user.
 *
 * `surviving` sets the tone: rows that made it mean a warning about a few
 * skipped ones; none surviving means the import is over before it started.
 */
export function describePlaceRowErrors(
  rowErrors: PlaceCsvRowError[],
  surviving: number,
  t: Translate
): string | null {
  if (rowErrors.length === 0) return null;
  if (surviving > 0) return t("places:import.errors.skippedRows", { count: rowErrors.length });
  return t("places:import.errors.noRows");
}
