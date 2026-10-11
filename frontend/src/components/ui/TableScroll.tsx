import type { ReactNode } from "react";

/**
 * A bare `<table>` in its own horizontal scroll region.
 *
 * A table is as wide as its columns need, and on a phone that is wider than
 * the card around it — which, with no scroll region of its own, widens the
 * whole document (the cruise day-pattern table pushed it to 334 px at 320,
 * forgejo#290). Wrap any table that is not already a `Table` primitive.
 * `tabIndex=0` keeps the region reachable by keyboard, which a scrollable
 * region must be; the label names it for a screen reader.
 */
export default function TableScroll({
  children,
  labelledBy,
}: {
  children: ReactNode;
  /** Id of the element that names the table. */
  labelledBy: string;
}): JSX.Element {
  return (
    <div
      className="max-w-full overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-labelledby={labelledBy}
    >
      {children}
    </div>
  );
}
