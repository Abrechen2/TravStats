import { resolveStayTiming } from "../shared/lodgingTiming";
import type { Lodging, LodgingStay } from "../types/lodging";

/**
 * The date a hotel is sorted and shown by: its NEWEST stay, planned ones
 * included.
 *
 * A hotel carries no date of its own — the stay does — and there are three
 * traps in deriving one:
 *
 * 1. "Newest" has to include the future. A hotel booked for next month belongs
 *    above one left last year; that is the owner's rule for every domain. So
 *    this cannot be a "most recent completed stay".
 * 2. The stay dates are read through `resolveStayTiming`, never off `checkIn`
 *    directly. A stay can be dated to a month or a year only (nullable since
 *    2.7), and that reader is where the project keeps those rules.
 * 3. A hotel with no datable stay gets no date at all rather than the epoch, so
 *    it sorts to the bottom instead of taking over the first screenful.
 *
 * Lives here rather than in `shared/` because both callers are frontend — the
 * activity sidebar and the lodging list comparator. It exists once on purpose:
 * a second copy is how the sidebar and the table would come to disagree about
 * what "last stay" means.
 */
export function latestStayDay(stays: readonly LodgingStay[] | undefined): string {
  let newest = "";
  for (const stay of stays ?? []) {
    const timing = resolveStayTiming({
      checkIn: stay.checkIn ? new Date(stay.checkIn) : null,
      checkOut: stay.checkOut ? new Date(stay.checkOut) : null,
      datePrecision: stay.datePrecision ?? "DAY",
      nights: stay.nights ?? null,
    });
    if (!timing.anchor) continue;
    const day = timing.anchor.toISOString().slice(0, 10);
    if (day > newest) newest = day;
  }
  return newest;
}

/** Same rule, taking the lodging itself. */
export function latestStayDayOf(lodging: Lodging): string {
  return latestStayDay(lodging.stays);
}
