/**
 * Once per boot: fill the operator of rail journeys that have none, from the
 * inference table (`services/rail/inferredOperator.ts`). Idempotent — a row
 * with an operator or a source is never read again — so a restart is harmless.
 */
import logger from "../utils/logger";
import { backfillInferredRailOperators } from "../services/rail/inferredOperator";

const BOOT_DELAY_MS = 3 * 60 * 1000;
let bootTimer: NodeJS.Timeout | null = null;

export function startRailOperatorBackfillScheduler(): void {
  if (bootTimer) return;
  bootTimer = setTimeout(() => {
    void backfillInferredRailOperators().catch((error) => {
      logger.warn(
        { operation: "rail_operator_backfill_error", error },
        "Rail operator backfill failed"
      );
    });
  }, BOOT_DELAY_MS);
  bootTimer.unref?.();
}

export function stopRailOperatorBackfillScheduler(): void {
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = null;
}
