import { statusPillStyle } from "../table/statusPillStyle";
import type { CruiseStatus } from "../../types";

interface PillStyle {
  background: string;
  color: string;
}

// Matches the flight-status palette from FlightsTablePage so the two
// domains read as one system: scheduled=blue, flown=green, cancelled=red.
// Historical picks up warning-amber — it's valid data but lacks exact
// times, so the colour signals "archival" without implying an error.
// in_progress (#status-from-dates) gets its own purple — distinct from both
// blue scheduled (future) and green flown (past) so a cruise currently under
// way reads as its own state, not a blend of the two.
/**
 * Delegates to the shared palette so all three lists agree. The table this
 * file used to own was already the correct one — amber for historical, purple
 * for in_progress — which is why it became the shared source rather than the
 * other way round.
 */
export function cruiseStatusPillStyle(status: CruiseStatus): PillStyle {
  return statusPillStyle(status);
}
