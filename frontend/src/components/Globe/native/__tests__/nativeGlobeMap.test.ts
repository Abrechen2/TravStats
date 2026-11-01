import { describe, it, expect, vi } from "vitest";
import type { Map as MapLibreMap, LayerSpecification } from "maplibre-gl";
import { createSyncState, nativeLayersMissing, syncNativeGlobe } from "../nativeGlobeMap";
import type { NativeGlobeSpec } from "../nativeGlobeLayers";

/** A map that keeps what is added to it, in stack order, like MapLibre's style. */
function fakeMap() {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  let layers: { id: string }[] = [];
  const map = {
    getStyle: () => ({ layers }),
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id: string) => sources.set(id, { setData: vi.fn() })),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    getLayer: (id: string) => layers.find((l) => l.id === id),
    addLayer: vi.fn((spec: { id: string }, before?: string) => {
      const at = before ? layers.findIndex((l) => l.id === before) : -1;
      layers = at < 0 ? [...layers, spec] : [...layers.slice(0, at), spec, ...layers.slice(at)];
    }),
    removeLayer: vi.fn((id: string) => {
      layers = layers.filter((l) => l.id !== id);
    }),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    setFilter: vi.fn(),
  };
  return {
    map: map as unknown as MapLibreMap,
    raw: map,
    order: () => layers.map((l) => l.id),
    swapStyle: () => {
      layers = [];
      sources.clear();
    },
  };
}

const fc = (n: number) => ({
  type: "FeatureCollection" as const,
  features: Array.from({ length: n }, () => ({
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Point" as const, coordinates: [0, 0] },
  })),
});
const layer = (id: string, color = "red") =>
  ({
    id,
    type: "circle",
    source: id,
    paint: { "circle-color": color },
  }) as unknown as LayerSpecification;

function spec(ids: string[], color = "red"): NativeGlobeSpec {
  return {
    sources: Object.fromEntries(ids.map((id) => [id, fc(1)])),
    layers: ids.map((id) => layer(id, color)),
    targets: new Map(),
    remainingExtras: [],
    hitOrder: [],
  };
}

describe("syncNativeGlobe (forgejo#331)", () => {
  it("adds the sources and the layers in stack order", () => {
    const m = fakeMap();
    syncNativeGlobe(m.map, spec(["a", "b", "c"]), createSyncState());
    expect(m.order()).toEqual(["a", "b", "c"]);
    expect(m.raw.addSource).toHaveBeenCalledTimes(3);
  });

  it("does nothing a second time for an unchanged spec", () => {
    const m = fakeMap();
    const s = spec(["a"]);
    const state = createSyncState();
    syncNativeGlobe(m.map, s, state);
    syncNativeGlobe(m.map, s, state);
    expect(m.raw.addSource).toHaveBeenCalledTimes(1);
    expect(m.raw.addLayer).toHaveBeenCalledTimes(1);
    expect(m.raw.setPaintProperty).not.toHaveBeenCalled();
  });

  it("re-paints a changed layer in place rather than re-adding it", () => {
    const m = fakeMap();
    const state = createSyncState();
    syncNativeGlobe(m.map, spec(["a"], "red"), state);
    syncNativeGlobe(m.map, { ...spec(["a"], "blue"), sources: { a: fc(1) } }, state);
    expect(m.raw.addLayer).toHaveBeenCalledTimes(1);
    expect(m.raw.setPaintProperty).toHaveBeenCalledWith("a", "circle-color", "blue");
  });

  it("slots a layer that appears later in under the one above it, not on top of everything", () => {
    const m = fakeMap();
    const state = createSyncState();
    syncNativeGlobe(m.map, spec(["lines", "dots"]), state);
    syncNativeGlobe(m.map, spec(["night", "lines", "dots"]), state);
    expect(m.order()).toEqual(["night", "lines", "dots"]);
  });

  it("removes a layer and its source when the spec stops naming them", () => {
    const m = fakeMap();
    const state = createSyncState();
    syncNativeGlobe(m.map, spec(["a", "b"]), state);
    syncNativeGlobe(m.map, spec(["a"]), state);
    expect(m.order()).toEqual(["a"]);
    expect(m.raw.removeSource).toHaveBeenCalledWith("b");
  });

  it("puts everything back after a basemap swap wiped the style", () => {
    const m = fakeMap();
    const s = spec(["a", "b"]);
    const state = createSyncState();
    syncNativeGlobe(m.map, s, state);
    expect(nativeLayersMissing(m.map, s)).toBe(false);
    m.swapStyle();
    expect(nativeLayersMissing(m.map, s)).toBe(true);
    // The hook clears its bookkeeping on a swap; the map is the truth.
    syncNativeGlobe(m.map, s, createSyncState());
    expect(m.order()).toEqual(["a", "b"]);
  });

  it("survives a style that is not ready, to retry on the next style event", () => {
    const m = fakeMap();
    m.raw.addSource.mockImplementation(() => {
      throw new Error("Style is not done loading");
    });
    expect(() => syncNativeGlobe(m.map, spec(["a"]), createSyncState())).not.toThrow();
  });
});
