import type { CSSProperties } from "react";
import { DASHED_STATUSES, STATUS_TOKEN, alpha, token } from "../ui/tokens";

/**
 * One status palette for every domain list — now the design system's.
 *
 * Each table used to carry its own. The flights table wrote its three cases as
 * a nested ternary whose ELSE branch caught everything that was not flown or
 * scheduled, so a `historical` flight from 2019 was painted in the cancelled
 * red, indistinguishable from a flight that never took off. Cruises had it
 * right in a separate file, and lodging had a third variant. Unifying them was
 * the first fix; this is the second, and it is a smaller change than it looks:
 * the palette moved from four literals in this file to `design/tokens.json`,
 * and the geometry from "rounded-full px-2 py-1 text-xs font-semibold" to the
 * recipe both apps share — colour as text, background at 12 %, border at 45 %,
 * 11px bold uppercase, never mono. The web drew 15 % with no border and no
 * capitals, which is why a status read as a label rather than as a state.
 *
 * The mapping itself lives in `components/ui/tokens.ts` beside the `StatusPill`
 * primitive, so a list and a primitive cannot answer the same question
 * differently. This module stays because four call sites take a style object
 * rather than a component; block 7 moves them onto `StatusPill` and this file
 * goes with them.
 */
export type DomainStatus =
  "flown" | "completed" | "scheduled" | "booked" | "in_progress" | "cancelled" | "historical";

export interface StatusPillStyle {
  background: string;
  color: string;
  border: string;
}

/**
 * An unknown status renders in the historical grey rather than falling into
 * the cancelled red. A status nobody has styled yet is not a failure, and the
 * previous catch-all else branch is the bug this function exists to prevent.
 */
export function statusPillStyle(status: string): StatusPillStyle {
  const name = STATUS_TOKEN[status] ?? "status-historical";
  const colour = token(name);
  const dashed = DASHED_STATUSES.has(status);
  return {
    color: colour,
    background: alpha(colour, 12),
    border: `1px ${dashed ? "dashed" : "solid"} ${alpha(colour, 45)}`,
  };
}

/** The pill's own geometry, so all four lists render the same shape. */
export const STATUS_PILL_CLASS = "ts-status-pill";

export function statusPillProps(status: string): {
  className: string;
  style: CSSProperties;
} {
  return { className: STATUS_PILL_CLASS, style: statusPillStyle(status) };
}
