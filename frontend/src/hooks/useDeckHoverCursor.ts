import { useCallback, useRef, useState } from "react";
import type { PickingInfo } from "@deck.gl/core";

export interface DeckHoverCursor {
  /** True while the pointer sits on a pickable deck.gl object. */
  isHovering: boolean;
  /** Pass to the deck overlay as `onHover`. */
  onHover: (info: PickingInfo) => void;
}

/**
 * A hand cursor over clickable map objects (#247).
 *
 * CSS cannot reach these: deck.gl draws its markers into MapLibre's canvas, so
 * the whole map is one element as far as the stylesheet is concerned. Only
 * deck's picking knows whether the pointer is over an airport, a port or a
 * lodging pin.
 *
 * Driving this from picking rather than from any single layer is deliberate —
 * it covers every pickable layer that exists now and every one added later,
 * including ones being built on another branch while this lands.
 *
 * `onHover` fires on every mouse move across the canvas, so the state is only
 * pushed when the boolean actually flips. Without that guard a slow drag across
 * a cluster of markers would re-render the map on each frame.
 */
export function useDeckHoverCursor(): DeckHoverCursor {
  const [isHovering, setIsHovering] = useState(false);
  const hoveringRef = useRef(false);

  const onHover = useCallback((info: PickingInfo): void => {
    const next = Boolean(info?.object);
    if (next === hoveringRef.current) return;
    hoveringRef.current = next;
    setIsHovering(next);
  }, []);

  return { isHovering, onHover };
}
