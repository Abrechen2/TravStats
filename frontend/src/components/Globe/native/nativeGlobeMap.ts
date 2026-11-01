// Puts a `NativeGlobeSpec` on a MapLibre map and keeps it there (forgejo#331).
//
// Idempotent: call it after every spec change and after every style swap.
// MapLibre drops custom sources and layers when the basemap style is replaced,
// so existence is read from the map, never trusted from our own bookkeeping;
// the bookkeeping only avoids re-sending data and paint that did not change.

import type { Map as MapLibreMap, GeoJSONSource, LayerSpecification } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { logger } from "../../../lib/logger";
import type { NativeGlobeSpec } from "./nativeGlobeLayers";

export interface NativeSyncState {
  /** Source id → the collection last handed to MapLibre. */
  data: Map<string, FeatureCollection>;
  /** Layer id → signature of its last-applied paint / layout / filter. */
  signature: Map<string, string>;
}

export const createSyncState = (): NativeSyncState => ({
  data: new Map(),
  signature: new Map(),
});

const sigOf = (l: LayerSpecification): string =>
  JSON.stringify([
    (l as { paint?: unknown }).paint,
    (l as { layout?: unknown }).layout,
    (l as { filter?: unknown }).filter,
  ]);

/** True when the spec names a layer the map does not have (a style swap ate it). */
export function nativeLayersMissing(map: MapLibreMap, spec: NativeGlobeSpec): boolean {
  return spec.layers.some((l) => !map.getLayer(l.id));
}

function applyProps(map: MapLibreMap, layer: LayerSpecification): void {
  const { paint, layout, filter } = layer as {
    paint?: Record<string, unknown>;
    layout?: Record<string, unknown>;
    filter?: unknown;
  };
  for (const [k, v] of Object.entries(paint ?? {}))
    map.setPaintProperty(layer.id, k as never, v as never);
  for (const [k, v] of Object.entries(layout ?? {}))
    map.setLayoutProperty(layer.id, k as never, v as never);
  if (filter !== undefined) map.setFilter(layer.id, filter as never);
}

/** Layers we put on the map earlier but the spec no longer names. */
function removeStale(map: MapLibreMap, spec: NativeGlobeSpec, state: NativeSyncState): void {
  const keepLayers = new Set(spec.layers.map((l) => l.id));
  for (const id of [...state.signature.keys()]) {
    if (keepLayers.has(id)) continue;
    if (map.getLayer(id)) map.removeLayer(id);
    state.signature.delete(id);
  }
  for (const id of [...state.data.keys()]) {
    if (id in spec.sources) continue;
    if (map.getSource(id)) map.removeSource(id);
    state.data.delete(id);
  }
}

export function syncNativeGlobe(
  map: MapLibreMap,
  spec: NativeGlobeSpec,
  state: NativeSyncState
): void {
  try {
    if (!map.getStyle()) return;
    removeStale(map, spec, state);
    for (const [id, fc] of Object.entries(spec.sources)) {
      const existing = map.getSource(id) as GeoJSONSource | undefined;
      if (!existing) {
        map.addSource(id, { type: "geojson", data: fc });
        state.data.set(id, fc);
      } else if (state.data.get(id) !== fc) {
        existing.setData(fc);
        state.data.set(id, fc);
      }
    }
    // Top to bottom, so a layer that has to be created lands directly under the
    // one above it — toggling the night shade on later must not put it over the dots.
    let above: string | undefined;
    for (let i = spec.layers.length - 1; i >= 0; i--) {
      const layer = spec.layers[i];
      const sig = sigOf(layer);
      if (!map.getLayer(layer.id)) {
        map.addLayer(layer, above);
        state.signature.set(layer.id, sig);
      } else if (state.signature.get(layer.id) !== sig) {
        applyProps(map, layer);
        state.signature.set(layer.id, sig);
      }
      above = layer.id;
    }
  } catch (err) {
    // Typically "Style is not done loading" mid-swap: the next style event retries.
    logger.warn("GlobeView: native layer sync failed", err);
  }
}

/** Take every native layer and source off the map (unmount). */
export function removeNativeGlobe(map: MapLibreMap, state: NativeSyncState): void {
  try {
    for (const id of state.signature.keys()) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of state.data.keys()) if (map.getSource(id)) map.removeSource(id);
  } catch {
    // The map is already being torn down.
  }
  state.signature.clear();
  state.data.clear();
}
