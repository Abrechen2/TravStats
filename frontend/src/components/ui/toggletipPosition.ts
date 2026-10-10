export type ToggletipSide = "top" | "bottom" | "left" | "right";

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

interface Viewport {
  width: number;
  height: number;
}

export interface ToggletipPlacement {
  side: ToggletipSide;
  left: number;
  top: number;
}

/** Gap between trigger and panel, and the margin kept to the viewport edge. */
const PADDING = 8;

function fits(side: ToggletipSide, anchor: Rect, panel: Rect, viewport: Viewport): boolean {
  switch (side) {
    case "top":
      return anchor.top - panel.height - PADDING >= 0;
    case "bottom":
      return anchor.bottom + panel.height + PADDING <= viewport.height;
    case "left":
      return anchor.left - panel.width - PADDING >= 0;
    case "right":
      return anchor.right + panel.width + PADDING <= viewport.width;
  }
}

/**
 * Where the help panel goes: the preferred side if it fits, otherwise the
 * opposite side on the same axis — whichever half of the viewport has more
 * room — and in every case clamped inside the viewport, so a help opened at
 * the edge of an iPad in portrait is never cut off. Returns the panel's
 * top-left corner in viewport coordinates (the panel is `position: fixed`).
 *
 * Pure, so the placement is tested without a layout engine (jsdom has none).
 */
export function placeToggletip(
  preferred: ToggletipSide,
  anchor: Rect,
  panel: Rect,
  viewport: Viewport
): ToggletipPlacement {
  let side = preferred;
  if (!fits(preferred, anchor, panel, viewport)) {
    if (preferred === "top" || preferred === "bottom") {
      side = anchor.top < viewport.height / 2 ? "bottom" : "top";
    } else {
      side = anchor.left < viewport.width / 2 ? "right" : "left";
    }
  }

  const centreX = anchor.left + anchor.width / 2;
  const centreY = anchor.top + anchor.height / 2;
  let left: number;
  let top: number;
  switch (side) {
    case "top":
      left = centreX - panel.width / 2;
      top = anchor.top - panel.height - PADDING;
      break;
    case "bottom":
      left = centreX - panel.width / 2;
      top = anchor.bottom + PADDING;
      break;
    case "left":
      left = anchor.left - panel.width - PADDING;
      top = centreY - panel.height / 2;
      break;
    case "right":
      left = anchor.right + PADDING;
      top = centreY - panel.height / 2;
      break;
  }

  const clamp = (value: number, size: number, limit: number): number =>
    Math.max(PADDING, Math.min(value, limit - size - PADDING));

  return {
    side,
    left: clamp(left, panel.width, viewport.width),
    top: clamp(top, panel.height, viewport.height),
  };
}
