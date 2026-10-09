import { staysConflict, type StaySpan } from "../shared/lodgingOverlap";
import { stayCheckIn, stayCheckOut } from "./entityTimes";
import type { LodgingStayListItem } from "../types/lodging";

/** A stored stay that collides with the one being saved. */
export interface StayConflict {
  stay: LodgingStayListItem;
  /** Same house: a likely duplicate, not just a second booking on the same nights. */
  sameHouse: boolean;
}

/**
 * A stored stay as the overlap rule reads it: its LOCAL calendar days
 * (`times.checkIn.date`, ADR 0002) - never the `checkIn` instant, which a
 * reader's zone could move onto the neighbouring day.
 */
export function storedStaySpan(stay: LodgingStayListItem): StaySpan {
  return {
    checkIn: stayCheckIn(stay)?.date ?? null,
    checkOut: stayCheckOut(stay)?.date ?? null,
    datePrecision: stay.datePrecision,
    cancelled: stay.status === "cancelled",
  };
}

/**
 * Which of `others` collide with `candidate` (forgejo#229, forgejo#227).
 *
 * `shared/lodgingOverlap.ts` owns the rule; this only adds who is asking: the
 * stay being edited does not collide with its own stored self, and a collision
 * in the same house is marked, because "this house already has a stay for these
 * days" is a duplicate warning and "another hotel the same night" is not.
 */
export function findStayConflicts(
  candidate: StaySpan,
  others: readonly LodgingStayListItem[],
  self: { stayId: string | null; lodgingId: string }
): StayConflict[] {
  return others
    .filter((other) => other.id !== self.stayId)
    .filter((other) => staysConflict(candidate, storedStaySpan(other)))
    .map((stay) => ({ stay, sameHouse: stay.lodgingId === self.lodgingId }));
}
