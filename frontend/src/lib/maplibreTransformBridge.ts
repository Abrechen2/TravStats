// Give `@deck.gl/mapbox` back the `map.transform` MapLibre 6 removed.
//
// MapLibre 6 made `Map` COMPOSE a Camera instead of extending one, and the
// internal `map.transform` went with it. `@deck.gl/mapbox` (9.3) reads exactly
// four values off it — nothing else in the module touches the property:
//
//   deck-utils.js:172  map.transform.height     (terrain path, mapbox-gl only)
//   deck-utils.js:195  map.transform.elevation  (terrain path, maplibre)
//   deck-utils.js:213  map.transform._nearZ     (fallback when the caller
//   deck-utils.js:214  map.transform._farZ       supplies no renderParameters)
//   deck-utils.js:216  map.transform.height     (normalising near/far)
//
// Without them the overlay throws on its first frame, which is why deck.gl
// 9.4 introduced `@deck.gl/maplibre` — the supported answer, and where this
// file's job ends. We are not on it yet: deck.gl 9.4.0 (published 2026-09-05)
// renders 8-bit colour attributes as if they were unnormalised floats, so
// every channel >= 1 clamps to full and the amber [240,169,71] arcs come out
// pure white. Measured on 2026-09-09 down to the pixel — main draws
// rgb(178,132,67), 9.4.0 draws rgb(255,255,255) — and reproduced in a bare
// deck.gl 9.4.0 page with one ArcLayer, no MapLibre and no code of ours, so it
// is not something this app provokes. deck.gl is therefore pinned to ~9.3.11
// and this bridge carries MapLibre 6 across.
//
// WHEN TO DELETE: the day deck.gl ships a 9.4.x whose colours are right.
// Then move to `@deck.gl/maplibre`'s MapLibreOverlay, drop the pin in
// package.json, and delete this file and its import in main.tsx. The bridge is
// a monkey patch on a library prototype; it earns its place only while that
// upgrade is blocked.
//
// The values come from public MapLibre 6 API, and deliberately mirror what
// deck.gl 9.4's own `@deck.gl/maplibre/compatibility.ts` reads:
//
//   height     the canvas height in CSS pixels, which is what `transform.height`
//              was. Used as a divisor, so a 0 would produce Infinity — the
//              getter falls back to 1 rather than hand that on.
//   elevation  `getCameraTargetElevation()` where present, else
//              `getCenterElevation()`. Only consulted when terrain is on.
//   _nearZ     left undefined ON PURPOSE. deck guards both with
//   _farZ      `Number.isFinite(...)` and falls back to its own
//              nearZMultiplier/farZMultiplier maths, which is the same path a
//              mapbox-gl map takes. Handing over a made-up number would be
//              worse than the documented fallback.

import { Map as MapLibreMap } from "maplibre-gl";

interface ElevationCapableMap {
  getCameraTargetElevation?: () => number;
  getCenterElevation?: () => number;
  getCanvas?: () => HTMLCanvasElement;
}

interface DeckTransformShim {
  height: number;
  elevation: number | undefined;
  _nearZ: number | undefined;
  _farZ: number | undefined;
}

function readElevation(map: ElevationCapableMap): number | undefined {
  const value = map.getCameraTargetElevation?.() ?? map.getCenterElevation?.();
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readHeight(map: ElevationCapableMap): number {
  const canvas = map.getCanvas?.();
  // clientHeight is CSS pixels, matching the old transform.height. A detached
  // or unsized canvas reports 0, and deck divides by this.
  const height = canvas?.clientHeight ?? 0;
  return height > 0 ? height : 1;
}

/**
 * Install the shim on MapLibre's Map prototype, once per page.
 *
 * On the prototype rather than per instance: every map in this app reaches
 * deck.gl through `useControl`, and there is no single place that sees them
 * all. A prototype property is also the honest shape — it is restoring
 * something the class used to have.
 *
 * Idempotent, and a no-op on any MapLibre that still has `transform` of its
 * own, so this file stays harmless if the property ever comes back.
 */
export function installMapLibreTransformBridge(): void {
  const proto = MapLibreMap.prototype as unknown as Record<string, unknown>;
  if ("transform" in proto) return;

  Object.defineProperty(proto, "transform", {
    configurable: true,
    enumerable: false,
    get(this: ElevationCapableMap): DeckTransformShim {
      return {
        height: readHeight(this),
        elevation: readElevation(this),
        _nearZ: undefined,
        _farZ: undefined,
      };
    },
  });
}
