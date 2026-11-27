/**
 * What a process that died left behind, looked at once at start. Each step
 * reports or removes only what cannot belong to a living operation, and a
 * failure in one never stops the start or the other step.
 *
 * - A restore that died while replacing the instance key is reported, never
 *   repaired by guessing (`backup/keySwapMarker.ts`).
 * - An import's upload and points file are removed (`travtrack/imports/spool.ts`).
 */
import logger from "../utils/logger";

export async function reportCrashLeftovers(): Promise<void> {
  try {
    const { reconcileKeySwapAtBoot } = await import("./backup/keySwapMarker");
    reconcileKeySwapAtBoot();
  } catch (error) {
    logger.error({ operation: "restore_key_swap_reconcile_error", error });
  }
  try {
    const { sweepSpoolAtStart } = await import("./travtrack/imports/spool");
    sweepSpoolAtStart();
  } catch (error) {
    logger.warn({ operation: "travtrack_spool_sweep_error", error });
  }
}
