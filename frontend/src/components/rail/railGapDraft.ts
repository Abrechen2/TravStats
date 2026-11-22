import type { GapDates } from "../../lib/gapCalendar";
import { draftFrom, type RailFormDraft } from "./railFormModel";

/** A new ride whose two ends are known only by their day: the gap's first and last day. */
export function railGapDraft(gap: GapDates): RailFormDraft {
  return {
    ...draftFrom(null),
    departureLocal: gap.from,
    arrivalLocal: gap.to,
    departureDayOnly: true,
    arrivalDayOnly: true,
  };
}
