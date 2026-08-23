import type { CSSProperties } from "react";

/**
 * One status palette for every domain list.
 *
 * Each table used to carry its own. The flights table wrote its three cases as
 * a nested ternary whose ELSE branch caught everything that was not flown or
 * scheduled — so a `historical` flight from 2019 was painted in the cancelled
 * red, indistinguishable from a flight that never took off. Cruises had it
 * right in a separate file (amber: archival, not an error), and lodging had a
 * third variant.
 *
 * `in_progress` was the other disagreement: purple on cruises, orange on
 * lodging, for the same state. Purple wins — orange is the brand accent and
 * already means "the thing you are looking at", which is not what a status is
 * for.
 */
export type DomainStatus =
  | "flown"
  | "completed"
  | "scheduled"
  | "booked"
  | "in_progress"
  | "cancelled"
  | "historical";

export interface StatusPillStyle {
  background: string;
  color: string;
}

const STATUS_STYLES: Record<DomainStatus, StatusPillStyle> = {
  // Done and recorded with real times.
  flown: { background: "rgba(63,185,80,0.15)", color: "var(--success)" },
  completed: { background: "rgba(63,185,80,0.15)", color: "var(--success)" },
  // Ahead of us.
  scheduled: { background: "rgba(56,139,253,0.15)", color: "#388bfd" },
  booked: { background: "rgba(56,139,253,0.15)", color: "#388bfd" },
  // Under way right now — its own state, not a blend of past and future.
  in_progress: { background: "rgba(163,113,247,0.15)", color: "#a371f7" },
  // Did not happen.
  cancelled: { background: "rgba(248,81,73,0.15)", color: "var(--danger)" },
  // Real, but recorded without exact times. Archival, NOT an error — which is
  // exactly what the flights table used to imply by painting it red.
  historical: { background: "rgba(251,191,36,0.15)", color: "#fbbf24" },
};

/**
 * An unknown status renders neutrally rather than falling into the cancelled
 * red. A status nobody has styled yet is not a failure, and the previous
 * catch-all else branch is the bug this function exists to prevent.
 */
const UNKNOWN_STYLE: StatusPillStyle = {
  background: "rgba(139,148,158,0.15)",
  color: "var(--text-muted)",
};

export function statusPillStyle(status: string): StatusPillStyle {
  return STATUS_STYLES[status as DomainStatus] ?? UNKNOWN_STYLE;
}

/** The pill's own geometry, so all three lists render the same shape. */
export const STATUS_PILL_CLASS =
  "inline-block whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold";

export function statusPillProps(status: string): {
  className: string;
  style: CSSProperties;
} {
  return { className: STATUS_PILL_CLASS, style: statusPillStyle(status) };
}
