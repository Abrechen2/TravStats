import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Lodging } from "../../types/lodging";

interface LodgingPinDatum {
  position: [number, number];
  lodgingId: string;
  name: string;
  type: Lodging["type"];
}

// Brand lodging rose (BRAND.md §3, --domain-lodging / shared/domains.ts
// DOMAINS.lodging.color = "#d4778f"). There's no CSS custom property for
// this domain yet (unlike --domain-flight/--domain-cruise) — this is the
// first lodging map layer, so the hex is inlined here the same way
// CRUISE_BASE_COLOR was before a `--domain-cruise` var existed.
const LODGING_RGB: [number, number, number] = [212, 119, 143];

const PIN_RADIUS_M = 2200;

/**
 * Build a ScatterplotLayer of lodging pins — one dot per hotel/campsite
 * with resolved coordinates. Mirrors the visual weight of the cruise-port
 * dot (`cruisePortsLayer.ts`'s `PORT_DOT_RADIUS_M`) so lodging markers read
 * as the same scale as other place markers on the map.
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
export function buildLodgingPins(lodgings: readonly Lodging[]): Layer | null {
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
    getRadius: PIN_RADIUS_M,
    radiusMinPixels: 4,
    radiusMaxPixels: 8,
    getFillColor: [...LODGING_RGB, 220],
    getLineColor: [255, 255, 255, 220],
    lineWidthUnits: "pixels",
    getLineWidth: 1,
    stroked: true,
    pickable: true,
  });
}
