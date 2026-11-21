// The order a trip visited its stops and places in, as the numbers on the map.
//
// Dated entries come first, by their own calendar day and then by the order
// they were entered in; undated ones follow in entry order. One sequence for
// stops and places together, because the reader walks the trip once, not
// "first the stops, then the places".

import type { DaySpan } from "./tripMapDays";

export interface SequenceInput {
  /** Stable across renders — the key a number is looked up by. */
  key: string;
  kind: "stop" | "place";
  span: DaySpan | null;
  /** Tie-break inside a day: the order the entries were written in. */
  order: number;
}

/** `key → 1-based number`, in trip order. */
export function numberInTripOrder(items: readonly SequenceInput[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => {
    if (a.span && b.span) {
      return a.span.start.localeCompare(b.span.start) || a.order - b.order;
    }
    if (a.span) return -1;
    if (b.span) return 1;
    return a.order - b.order;
  });
  return new Map(sorted.map((item, index) => [item.key, index + 1]));
}
