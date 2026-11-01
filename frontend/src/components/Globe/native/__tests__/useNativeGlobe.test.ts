import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { MapRef } from "react-map-gl/maplibre";
import { createCursorMux, useNativeGlobe } from "../useNativeGlobe";
import { NATIVE_IDS, type NativeGlobeInput } from "../nativeGlobeLayers";
import { DEFAULT_LODGING_COLOR_CONFIG } from "../../../../lib/lodgingColor";
import { DEFAULT_PLACE_COLOR_CONFIG } from "../../../../lib/placeColor";
import { ALL_ROUTES_VISIBLE } from "../../../../lib/mapRoutes";
import type { PointDatum } from "../../globeLayerTypes";

/** The pointer half of forgejo#331: what deck.gl's picking used to do. */

const MUC: PointDatum = { position: [11.78, 48.35], size: 3, iata: "MUC", name: "Munich" };
const INPUT: NativeGlobeInput = {
  nightCells: [],
  showNight: false,
  cruisePaths: [],
  cruiseWidthScale: 1,
  airportPoints: [MUC],
  airportColor: [1, 1, 1],
  airportRadius: 5,
  portPoints: [],
  portColor: [2, 2, 2],
  portRadius: 5,
  lodgings: [],
  lodgingColors: DEFAULT_LODGING_COLOR_CONFIG,
  places: [],
  placeColors: DEFAULT_PLACE_COLOR_CONFIG,
  placeRadius: 5,
  lodgingRadius: 5,
  extraLayers: [],
  routesVisible: ALL_ROUTES_VISIBLE,
  lite: false,
} as unknown as NativeGlobeInput;

function setup(features: unknown[]) {
  const handlers = new Map<string, (e: unknown) => void>();
  const canvasHandlers = new Map<string, () => void>();
  const layers = new Set<string>();
  const map = {
    getStyle: () => ({ layers: [] }),
    getSource: () => undefined,
    addSource: vi.fn(),
    removeSource: vi.fn(),
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    addLayer: vi.fn((spec: { id: string }) => layers.add(spec.id)),
    removeLayer: vi.fn(),
    on: vi.fn((name: string, fn: (e: unknown) => void) => handlers.set(name, fn)),
    off: vi.fn(),
    getCanvas: () => ({
      style: {},
      addEventListener: (n: string, f: () => void) => canvasHandlers.set(n, f),
      removeEventListener: vi.fn(),
    }),
    queryRenderedFeatures: vi.fn(() => features),
    setFeatureState: vi.fn(),
    removeFeatureState: vi.fn(),
  };
  const opts = {
    mapRef: { current: { getMap: () => map } as unknown as MapRef },
    mapReady: true,
    input: INPUT,
    hover: { airport: vi.fn(), port: vi.fn(), cruise: vi.fn(), pin: vi.fn() },
    hideTooltip: vi.fn(),
    setPinned: vi.fn(),
    onOverChange: vi.fn(),
  };
  const hook = renderHook(() => useNativeGlobe(opts));
  // The layers exist once sync has run; make the fake map say so.
  map.addLayer.mock.calls.forEach(([spec]) => layers.add((spec as { id: string }).id));
  return { map, handlers, canvasHandlers, opts, hook };
}

const airportFeature = {
  id: 1,
  source: NATIVE_IDS.airports,
  layer: { id: NATIVE_IDS.airports },
  properties: { i: 0 },
};

describe("useNativeGlobe pointer events", () => {
  it("puts the native layers on the map once it is ready", () => {
    const { map } = setup([]);
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: NATIVE_IDS.airports, type: "circle" }),
      undefined
    );
  });

  it("shows the airport tooltip, the hand cursor and a highlight while hovering a dot", () => {
    const { map, handlers, opts } = setup([airportFeature]);
    act(() => handlers.get("mousemove")!({ point: { x: 10, y: 20 } }));
    expect(opts.hover.airport).toHaveBeenCalledWith(
      expect.objectContaining({ object: MUC, x: 10, y: 20 })
    );
    expect(opts.onOverChange).toHaveBeenLastCalledWith(true);
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: NATIVE_IDS.airports, id: 1 },
      { hover: true }
    );
  });

  it("hides the tooltip and clears the highlight when the pointer leaves the dot", () => {
    const { map, handlers, opts } = setup([airportFeature]);
    act(() => handlers.get("mousemove")!({ point: { x: 10, y: 20 } }));
    map.queryRenderedFeatures.mockReturnValue([]);
    act(() => handlers.get("mousemove")!({ point: { x: 90, y: 90 } }));
    expect(opts.hideTooltip).toHaveBeenCalledTimes(1);
    expect(opts.onOverChange).toHaveBeenLastCalledWith(false);
    expect(map.removeFeatureState).toHaveBeenCalledWith({ source: NATIVE_IDS.airports, id: 1 });
  });

  it("leaves the tooltip alone while the pointer is over nothing native (deck.gl's arcs own it)", () => {
    const { handlers, opts } = setup([]);
    act(() => handlers.get("mousemove")!({ point: { x: 1, y: 1 } }));
    expect(opts.hideTooltip).not.toHaveBeenCalled();
  });

  it("pins the airport's card on click", () => {
    const { handlers, opts } = setup([airportFeature]);
    act(() => handlers.get("click")!({ point: { x: 10, y: 20 }, lngLat: { lng: 1, lat: 2 } }));
    expect(opts.setPinned).toHaveBeenCalledWith({
      kind: "airport",
      data: MUC,
      anchorLngLat: [11.78, 48.35],
    });
  });

  it("pins nothing for a click on empty globe", () => {
    const { handlers, opts } = setup([]);
    act(() => handlers.get("click")!({ point: { x: 10, y: 20 }, lngLat: { lng: 1, lat: 2 } }));
    expect(opts.setPinned).not.toHaveBeenCalled();
  });

  it("tells deck.gl's arcs when a native feature lies under a pixel", () => {
    const { hook, map } = setup([airportFeature]);
    expect(hook.result.current.isOverNative(5, 5)).toBe(true);
    map.queryRenderedFeatures.mockReturnValue([]);
    expect(hook.result.current.isOverNative(5, 5)).toBe(false);
  });

  it("searches a few pixels around the pointer, so a 1 px line can be hit", () => {
    const { handlers, map } = setup([]);
    act(() => handlers.get("mousemove")!({ point: { x: 100, y: 100 } }));
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
      [
        [95, 95],
        [105, 105],
      ],
      expect.anything()
    );
  });
});

describe("createCursorMux", () => {
  it("shows the hand while either deck.gl or a native layer wants it", () => {
    const canvas = { style: { cursor: "" } } as HTMLCanvasElement;
    const mux = createCursorMux(() => canvas);
    mux.set("deck", true);
    expect(canvas.style.cursor).toBe("pointer");
    mux.set("native", true);
    mux.set("deck", false);
    expect(canvas.style.cursor).toBe("pointer");
    mux.set("native", false);
    expect(canvas.style.cursor).toBe("");
  });
});
