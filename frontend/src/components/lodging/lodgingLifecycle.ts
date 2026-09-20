/**
 * The lifecycle rule moved to `shared/lodgingLifecycle.ts` on 2026-09-20, when
 * the lodging list's status FILTER moved to the server: the rule now has to be
 * applied in SQL over rows the browser never sees, so it needs a home on both
 * sides, which in this project means `shared/` with a mirror. This file stays
 * as the import path every caller already names — a re-export, not a copy.
 */
export {
  lodgingLifecycleStatus,
  LIFECYCLE_SORT_RANK,
  LIFECYCLE_RANK_STAYLESS,
  lodgingLifecycleRank,
  LODGING_LIFECYCLE_STATUSES,
  type LodgingLifecycleStatus,
} from "../../shared/lodgingLifecycle";
