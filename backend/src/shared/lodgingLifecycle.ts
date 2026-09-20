/**
 * The lifecycle STATUS of a lodging row — the pill the list draws, and the
 * value its status filter selects on.
 *
 * Not to be confused with `shared/lodgingCounting.ts`. That module answers
 * "does this stay count towards a figure" and derives its answer from the
 * DATES, because the stored `status` column is a cache an hourly sweep
 * converges. This one answers "what does this house look like right now" and
 * reads the STORED column on purpose: the pill and the filter beside it are a
 * view of the record as the user last left it, and a row whose pill changed
 * between two page loads because a sweep had not run yet would be a worse lie
 * than a stale one. The two rules are deliberately different and must not be
 * folded together.
 *
 * Priority: a running stay beats a booked one beats history; "cancelled" only
 * shows when cancellations are ALL the house has — a hotel with nine completed
 * stays and one cancelled booking is not a "cancelled hotel". `null` = no
 * stays at all (the list marks those "vorgemerkt" in the name column).
 *
 * Lived in `frontend/src/components/lodging/lodgingLifecycle.ts` alone until
 * the lodging list moved its paging to the server (2026-09-20): the filter now
 * has to be applied in SQL over rows the browser never sees, so the rule needs
 * a backend home. MIRRORED in `frontend/src/shared/lodgingLifecycle.ts`, same
 * convention as shared/lodgingCounting.ts and shared/domains.ts — nothing
 * checks that the two agree, each side has its own test of the same truth
 * table. Change both together.
 */

/** The four stored stay statuses, in the order the pill ranks them. */
export const LODGING_LIFECYCLE_STATUSES = [
  "in_progress",
  "scheduled",
  "completed",
  "cancelled",
] as const;

export type LodgingLifecycleStatus = (typeof LODGING_LIFECYCLE_STATUSES)[number];

export interface LifecycleStay {
  status: string;
}

export function lodgingLifecycleStatus(
  stays: readonly LifecycleStay[]
): LodgingLifecycleStatus | null {
  if (stays.length === 0) return null;
  if (stays.some((s) => s.status === "in_progress")) return "in_progress";
  if (stays.some((s) => s.status === "scheduled")) return "scheduled";
  if (stays.some((s) => s.status === "completed")) return "completed";
  return "cancelled";
}

/** Sort rank for the status column — running first, then booked, then past. */
export const LIFECYCLE_SORT_RANK: Record<LodgingLifecycleStatus, number> = {
  in_progress: 0,
  scheduled: 1,
  completed: 2,
  cancelled: 3,
};

/** The rank a stayless (merely bookmarked) house sorts at: after all four. */
export const LIFECYCLE_RANK_STAYLESS = 4;

/** One number per house, for the status sort — the ranks above, stayless last. */
export function lodgingLifecycleRank(stays: readonly LifecycleStay[]): number {
  const status = lodgingLifecycleStatus(stays);
  return status === null ? LIFECYCLE_RANK_STAYLESS : LIFECYCLE_SORT_RANK[status];
}
