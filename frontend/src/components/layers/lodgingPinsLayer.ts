import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { DOMAINS } from "../../shared/domains";
import type { Lodging } from "../../types/lodging";
import { hexToRgb } from "../map/controlPanelKit";
import { markerDotRadiusProps } from "./markerDotStyle";

interface LodgingPinDatum {
  position: [number, number];
  lodgingId: string;
  name: string;
  type: Lodging["type"];
}

// Brand lodging rose (BRAND.md §3), derived from the single source of truth
// `DOMAINS.lodging.color` (shared/domains.ts) rather than a second inlined
// hex — there's no CSS custom property for this domain yet (unlike
// --domain-flight/--domain-cruise), so this map layer needs the RGB tuple
// deck.gl expects. `hexToRgb` is the ONE shared implementation exported by
// controlPanelKit.tsx (Task 8) — this layer used to hand-roll its own copy.
const LODGING_RGB: [number, number, number] = hexToRgb(DOMAINS.lodging.color);

/**
 * Build a ScatterplotLayer of lodging pins — one dot per hotel/campsite
 * with resolved coordinates. Sized via the SAME model as the airport dot
 * (`routesLayer.ts`'s `routes-dot`) and the cruise-port dot
 * (`cruisePortsLayer.ts`'s `cruise-ports`) — `markerDotRadiusProps` from
 * `markerDotStyle.ts` (#187) — so lodging markers read as the same visual
 * weight and respond to the same size-slider semantics: `sizeScale` is the
 * user's marker-size slider multiplier (1 = default, 0 = "Aus" — the pixel
 * radius clamps collapse to 0, same as flight/cruise markers). This layer
 * used to hand-copy its own 2200 m radius constant and a fixed 4/8 pixel
 * clamp with no scale input at all.
 *
 * A `Lodging`'s `lat`/`lon` are independently nullable — set by the user
 * pinning a location manually or by the OSM geocoder on save, and either
 * can fail/be skipped. Only lodgings with BOTH coordinates present are
 * plotted; a lodging with just one of the pair is not a location (it would
 * plot at `NaN` and crash the layer, or silently collapse to `(0, lon)` /
 * `(lat, 0)`), so it's filtered out same as a fully coordinate-less one.
 *
 * Returns `null` when no lodging qualifies so callers can omit the layer
 * entirely rather than mounting a no-op (same convention as
 * `createCruisePortsLayer`/`createCruiseArcsLayer`).
 */
export function buildLodgingPins(
  lodgings: readonly Lodging[],
  sizeScale: number = 1
): Layer | null {
  const data: LodgingPinDatum[] = [];
  for (const lodging of lodgings) {
    if (lodging.lat === null || lodging.lon === null) continue;
    data.push({
      position: [lodging.lon, lodging.lat],
      lodgingId: lodging.id,
      name: lodging.name,
      type: lodging.type,
    });
  }
  if (data.length === 0) return null;

  return new ScatterplotLayer<LodgingPinDatum>({
    id: "lodging-pins",
    data,
    getPosition: (d) => d.position,
    ...markerDotRadiusProps(sizeScale),
    getFillColor: [...LODGING_RGB, 220],
    getLineColor: [255, 255, 255, 220],
    lineWidthUnits: "pixels",
    getLineWidth: 1,
    stroked: true,
    pickable: true,
  });
}
