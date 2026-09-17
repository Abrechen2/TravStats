import { useToastStore } from "../../store/toastStore";

/**
 * Tell the user what a multi-leg import actually did — split out of
 * useFlightForm.ts (file-size debt, forgejo#59); the rules are unchanged.
 */
export function reportBatchOutcome(
  batchResult: { count?: number; skipped?: number },
  submittedCount: number,
  t: (key: string, options?: Record<string, unknown>) => string
): void {
  /**
   * Say what the import actually did.
   *
   * Forgejo #13: re-importing the same multi-leg MSG replayed the whole
   * review wizard with no duplicate warning, and after the final click
   * the dialog simply closed. The flight count did not move and nothing
   * said why — the server had skipped every row as already present, and
   * the frontend threw that number away, using only `newAchievements`
   * from the response.
   *
   * A silent no-op after four screens of review is the worst available
   * outcome: the user cannot tell it from a failure, so they try again.
   */
  const created = batchResult.count ?? 0;
  const skipped = batchResult.skipped ?? 0;
  const toast = useToastStore.getState().addToast;
  if (created === 0 && skipped > 0) {
    toast("info", t("flights:review.batchAllDuplicates", { count: skipped }));
  } else if (skipped > 0) {
    toast("success", t("flights:review.batchImportedWithSkips", { created, skipped }));
  } else if (created > 0) {
    toast("success", t("flights:review.batchImported", { count: created }));
  } else if (submittedCount > 0) {
    // Neither created nor skipped, yet rows were sent: something is
    // wrong that no other branch describes, and silence would hide it.
    toast("error", t("errors:saveFailed"));
  }
}
