/**
 * The data-quality inbox — records that contradict themselves, raised as
 * questions.
 *
 * Owner's decision, 2026-09-02, design §3.5: flag, never refuse. Read
 * `runner.ts` for what a re-run does and `schemas/dataQualityFlag.ts` for the
 * vocabulary; the checks themselves each carry the rule they encode.
 */

export { listFlags, getFlagView, type ListFlagsFilters } from "./flagService";
export {
  dismissFinding,
  resolveFinding,
  undoFinding,
  FindingActionError,
  FINDING_UNDO_WINDOW_MS,
} from "./findingActions";
export { runDataQualityChecks, type DataQualityRunSummary } from "./runner";
