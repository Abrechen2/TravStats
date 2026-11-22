import type { GapDates } from "../../lib/gapCalendar";
import { draftFrom, type BusFormDraft } from "./busFormModel";

/** A new ride whose two ends are known only by their day: the gap's first and last day. */
export function busGapDraft(gap: GapDates): BusFormDraft {
  return {
    ...draftFrom(null),
    departureLocal: gap.from,
    arrivalLocal: gap.to,
    departureDayOnly: true,
    arrivalDayOnly: true,
  };
}
