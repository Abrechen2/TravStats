// The positioned frame a pinned card sits in, on every map (forgejo#323
// browser look). It measures itself and the map it floats over and asks
// `placeCard` for a spot fully inside the map — 16 px from every edge, clear
// of the side list when that is open — instead of a fixed offset that ran the
// card off the right edge near Chiang Mai.
//
// z-45 puts the card above the map's floating panels (Als nächstes 30, the
// domain filter and legend 35, the side list and filter panel 40) and below
// the modal layer (90): the card is what the reader just asked for by
// clicking, so the chrome may not cover its heading.

import { useLayoutEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from "react";
import { placeCard, type Box, type Insets, type Point } from "./placeFloating";

export const FLOATING_CARD_Z = 45;

/**
 * What the side list covers of `container`, as a left inset. Found by its
 * class rather than threaded through as a prop: the list belongs to the
 * dashboard layout, the card to the map, and the two never meet otherwise.
 */
export function sideListInsets(container: HTMLElement): Insets {
  const list = document.querySelector<HTMLElement>(".ts-activity-panel");
  if (!list || list.offsetParent === null) return {};
  const c = container.getBoundingClientRect();
  const l = list.getBoundingClientRect();
  const overlapsVertically = l.bottom > c.top && l.top < c.bottom;
  if (!overlapsVertically || l.right <= c.left || l.left > c.left + 1) return {};
  return { left: Math.min(c.width, l.right - c.left) };
}

/** The container a box measures against: its positioned ancestor. */
function measuredContainer(el: HTMLElement): HTMLElement | null {
  const parent = el.offsetParent as HTMLElement | null;
  return parent && parent.clientWidth > 0 && parent.clientHeight > 0 ? parent : null;
}

/** Re-measure when the box changes size (a list opened inside the card). */
export function useResizeTick(ref: RefObject<HTMLElement | null>): number {
  const [tick, setTick] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setTick((n) => n + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return tick;
}

export function FloatingCard({
  anchor,
  zIndex = FLOATING_CARD_Z,
  testId,
  children,
}: {
  /** The anchor in the map container's pixels. */
  anchor: Point;
  zIndex?: number;
  testId?: string;
  children: ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const tick = useResizeTick(ref);
  const { x, y } = anchor;

  useLayoutEffect(() => {
    const el = ref.current;
    const container = el ? measuredContainer(el) : null;
    if (!el || !container) return;
    const next = placeCard(
      { x, y },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: container.clientWidth, height: container.clientHeight },
      sideListInsets(container)
    );
    setBox((prev) =>
      prev && prev.left === next.left && prev.top === next.top && prev.side === next.side
        ? prev
        : next
    );
  }, [x, y, tick]);

  return (
    <div
      ref={ref}
      data-testid={testId}
      data-side={box?.side}
      className="absolute pointer-events-auto"
      // Unmeasured (no layout yet, or a test without one): centred above the
      // anchor, the placement the card always had.
      style={
        box
          ? { left: box.left, top: box.top, zIndex }
          : {
              left: anchor.x,
              top: anchor.y,
              zIndex,
              transform: "translate(-50%, calc(-100% - 14px))",
            }
      }
    >
      {children}
    </div>
  );
}
