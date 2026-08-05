/**
 * Progress state for the trip-timeline rail (#184).
 *
 * The timeline marks past vs. upcoming activities on the left-hand rail —
 * the connector line and its dots — instead of graying out whole entries.
 * The rail "fills up" as the trip advances: every dot whose event has
 * happened is coloured, and the line is filled exactly up to the last
 * past dot.
 */
export interface RailState {
  /** The event itself has happened (dot gets its domain colour). */
  dotPast: boolean;
  /** Segment from the previous dot down to this dot is filled. */
  topFilled: boolean;
  /** Segment from this dot down to the next dot is filled. */
  bottomFilled: boolean;
}

/**
 * Computes the rail state for a chronologically sorted list of event dates.
 * A segment between two dots is filled only when the *later* event is past,
 * so the coloured rail always ends at the last dot that has been reached.
 */
export function computeRailStates(dates: string[], nowMs: number): RailState[] {
  const past = dates.map((d) => new Date(d).getTime() <= nowMs);
  return past.map((dotPast, i) => ({
    dotPast,
    topFilled: dotPast,
    bottomFilled: past[i + 1] ?? false,
  }));
}
