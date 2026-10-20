// Where a map card and a hover tooltip go so they stay on screen.
//
// Browser look on forgejo#323: the card for a station near the right edge ran
// off the map and under the "Als nächstes" panel, and the tooltip was clipped
// the same way — both were placed at a fixed offset from the point with no
// look at the map's edges. Both renderers (flat map, globe) and the trip map
// share this one rule, so the flight card is fixed by the same change.
//
// Pure geometry in the map container's own pixels: the caller measures the
// box and the container, and passes the strip a side list covers as an inset.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Parts of the map covered by chrome, e.g. the side list's 320 px on the left. */
export interface Insets {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

export interface Box {
  left: number;
  top: number;
  /** Which side of the point the box ended up on. */
  side: "above" | "below";
}

/** Distance kept from every edge of the map. */
export const FLOAT_MARGIN_PX = 16;
/** Gap between a card's tail and its anchor. */
const CARD_GAP_PX = 14;
/** A tooltip's offset from the pointer. */
const TIP_OFFSET_PX = 12;

function bounds(
  view: Size,
  insets: Insets
): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: (insets.left ?? 0) + FLOAT_MARGIN_PX,
    maxX: view.width - (insets.right ?? 0) - FLOAT_MARGIN_PX,
    minY: (insets.top ?? 0) + FLOAT_MARGIN_PX,
    maxY: view.height - (insets.bottom ?? 0) - FLOAT_MARGIN_PX,
  };
}

/** `value` moved into [min, max - size]; a box larger than the room aligns to `min`. */
function clamp(value: number, size: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max - size));
}

/**
 * A pinned card: centred above its anchor, flipped below when there is no room
 * above, then moved inside the map — so it may no longer point exactly at the
 * anchor near an edge, but it is always readable whole.
 */
export function placeCard(anchor: Point, size: Size, view: Size, insets: Insets = {}): Box {
  const b = bounds(view, insets);
  const aboveTop = anchor.y - CARD_GAP_PX - size.height;
  const side: Box["side"] =
    aboveTop >= b.minY || anchor.y + CARD_GAP_PX + size.height > b.maxY ? "above" : "below";
  const top = side === "above" ? aboveTop : anchor.y + CARD_GAP_PX;
  return {
    left: clamp(anchor.x - size.width / 2, size.width, b.minX, b.maxX),
    top: clamp(top, size.height, b.minY, b.maxY),
    side,
  };
}

/**
 * A hover tooltip: right of and below the pointer, flipped to its left or
 * above when that side has no room — never over the thing being pointed at
 * when it can be helped — then moved inside the map.
 */
export function placeTooltip(pointer: Point, size: Size, view: Size, insets: Insets = {}): Box {
  const b = bounds(view, insets);
  const right = pointer.x + TIP_OFFSET_PX;
  const left = right + size.width <= b.maxX ? right : pointer.x - TIP_OFFSET_PX - size.width;
  const below = pointer.y + TIP_OFFSET_PX;
  const fitsBelow = below + size.height <= b.maxY;
  const top = fitsBelow ? below : pointer.y - TIP_OFFSET_PX - size.height;
  return {
    left: clamp(left, size.width, b.minX, b.maxX),
    top: clamp(top, size.height, b.minY, b.maxY),
    side: fitsBelow ? "below" : "above",
  };
}
