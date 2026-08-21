import type { LodgingStay, StayStatus } from "../../types/lodging";

/**
 * The lifecycle STATUS of a lodging row — derived from its stays, the way a
 * flight row carries its own status. Not to be confused with
 * `lodgingCompleteness.ts`, which tags data-quality issues (no location, no
 * address); this here is about time: is someone there right now, is a stay
 * booked, or is everything in the past?
 *
 * Priority: a running stay beats a booked one beats history; "cancelled"
 * only shows when cancellations are ALL the lodging has — a hotel with nine
 * completed stays and one cancelled booking is not a "cancelled hotel".
 * `null` = no stays at all (the list already marks those "vorgemerkt").
 */
export function lodgingLifecycleStatus(stays: readonly LodgingStay[]): StayStatus | null {
  if (stays.length === 0) return null;
  if (stays.some((s) => s.status === "in_progress")) return "in_progress";
  if (stays.some((s) => s.status === "scheduled")) return "scheduled";
  if (stays.some((s) => s.status === "completed")) return "completed";
  return "cancelled";
}

/** Sort rank for the status column — running first, then booked, then past. */
export const LIFECYCLE_SORT_RANK: Record<StayStatus, number> = {
  in_progress: 0,
  scheduled: 1,
  completed: 2,
  cancelled: 3,
};
