/**
 * The map's controls, as rectangles a label must keep out of (beta.22 UAT:
 * "Vigelandsparken" printed across the globe's activity histogram).
 *
 * The controls are plain DOM floated over the map, mounted by different
 * owners — the globe (histogram, control panel, stats card), the dashboard
 * (activity toggle, key, domain filter, add button). Each marks its root with
 * `MAP_CHROME`; the globe's HTML label overlay reads every marked box that
 * covers the map and places no label there. A control added later is covered
 * the day it carries the attribute.
 *
 * The flat map does not use this: its labels are drawn into the WebGL canvas
 * UNDER the controls, like the basemap's own place names, and are picked once
 * per zoom step rather than per pan frame — a control is a fixed spot on the
 * screen, so reserving it would mean a re-pick on every pan.
 */
export const MAP_CHROME = { "data-map-chrome": "" } as const;

const SELECTOR = "[data-map-chrome]";

/** A screen rectangle in the map's own pixels (its top-left is 0, 0). */
export interface ChromeBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The marked controls that are on screen — the ones a resize can move. */
export function mapChromeElements(): Element[] {
  return Array.from(document.querySelectorAll(SELECTOR));
}

/**
 * Every marked control that covers part of `map`, in `map`'s pixels. A
 * hidden control (no size) reserves nothing.
 */
export function measureMapChrome(map: Element, elements: readonly Element[]): ChromeBox[] {
  const frame = map.getBoundingClientRect();
  const boxes: ChromeBox[] = [];
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right <= frame.left || r.left >= frame.right) continue;
    if (r.bottom <= frame.top || r.top >= frame.bottom) continue;
    boxes.push({
      x0: r.left - frame.left,
      y0: r.top - frame.top,
      x1: r.right - frame.left,
      y1: r.bottom - frame.top,
    });
  }
  return boxes;
}

/** Whether the box `x, y, w, h` touches any of `chrome`. */
export function hitsMapChrome(
  chrome: readonly ChromeBox[],
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  for (let i = 0; i < chrome.length; i++) {
    const c = chrome[i];
    if (x < c.x1 && x + w > c.x0 && y < c.y1 && y + h > c.y0) return true;
  }
  return false;
}
