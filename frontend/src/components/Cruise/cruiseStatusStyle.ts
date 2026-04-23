import type { CruiseStatus } from "../../types";

interface PillStyle {
  background: string;
  color: string;
}

// Matches the flight-status palette from FlightsTablePage so the two
// domains read as one system: scheduled=blue, flown=green, cancelled=red.
// Historical picks up warning-amber — it's valid data but lacks exact
// times, so the colour signals "archival" without implying an error.
const CRUISE_STATUS_STYLES: Record<CruiseStatus, PillStyle> = {
  scheduled: { background: "rgba(56,139,253,0.15)", color: "#388bfd" },
  flown: { background: "rgba(63,185,80,0.15)", color: "var(--success)" },
  cancelled: { background: "rgba(248,81,73,0.15)", color: "var(--danger)" },
  historical: { background: "rgba(251,191,36,0.15)", color: "#fbbf24" },
};

export function cruiseStatusPillStyle(status: CruiseStatus): PillStyle {
  return CRUISE_STATUS_STYLES[status];
}
