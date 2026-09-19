import { useLayoutEffect, type RefObject } from "react";

/**
 * Scrolls a horizontally scrolling row so `child` is fully visible — the row
 * only, never the page.
 *
 * `element.scrollIntoView()` would do it and also scroll every ancestor,
 * the window included, so opening `/stats?tab=poi` on a phone jumped the page
 * down to the tab strip. This moves `scrollLeft` alone, by the least amount
 * that shows the child with a little air (CT106 audit B06: the active tab sat
 * off the right edge on a direct entry).
 */
export function revealInRow(row: HTMLElement, child: HTMLElement, margin = 16): void {
  const rowBox = row.getBoundingClientRect();
  const childBox = child.getBoundingClientRect();
  if (childBox.left < rowBox.left + margin) {
    row.scrollLeft -= rowBox.left + margin - childBox.left;
  } else if (childBox.right > rowBox.right - margin) {
    row.scrollLeft += childBox.right - (rowBox.right - margin);
  }
}

/**
 * Keeps the element matching `selector` revealed in the scrolling `row`: when
 * the dependencies change, and again whenever that element changes size.
 *
 * The second half is not decoration. Measured at 320px, the first reveal ran
 * with the widths from before the web fonts and emoji had loaded; the tabs grew
 * afterwards and the active one slid 6px back out of view.
 */
export function useRevealActive(
  rowRef: RefObject<HTMLElement | null>,
  selector: string,
  deps: readonly unknown[]
): void {
  useLayoutEffect(() => {
    const row = rowRef.current;
    const current = row?.querySelector<HTMLElement>(selector);
    if (!row || !current) return;
    revealInRow(row, current);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => revealInRow(row, current));
    observer.observe(current);
    return (): void => observer.disconnect();
    // The caller names what should re-run it; `rowRef` and `selector` are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
