import { describe, it, expect, vi } from "vitest";
import { PathLayer } from "@deck.gl/layers";
import {
  dispatchNativeHover,
  pinnedFromHit,
  resolveNativeHit,
  type NativeHoverHandlers,
} from "../nativeGlobeHits";
import { NATIVE_IDS, buildNativeGlobe, type NativeGlobeInput } from "../nativeGlobeLayers";
import { DEFAULT_LODGING_COLOR_CONFIG } from "../../../../lib/lodgingColor";
import { DEFAULT_PLACE_COLOR_CONFIG } from "../../../../lib/placeColor";
import { ALL_ROUTES_VISIBLE } from "../../../../lib/mapRoutes";
import type { Lodging } from "../../../../types/lodging";
import type { CruisePathDatum, PointDatum } from "../../globeLayerTypes";

const MUC: PointDatum = { position: [11.78, 48.35], size: 3, iata: "MUC", name: "Munich" };
const CRUISE: CruisePathDatum = {
  cruiseId: "c1",
  cruiseLabel: "AIDA",
  status: "completed",
  color: [1, 2, 3],
  path: [
    [8, 50],
    [9, 51],
  ],
};

function spec(over: Partial<NativeGlobeInput> = {}) {
  return buildNativeGlobe({
    nightCells: [],
    showNight: false,
    cruisePaths: [CRUISE],
    cruiseWidthScale: 1,
    airportPoints: [MUC],
    airportColor: [1, 1, 1],
    airportRadius: 5,
    portPoints: [],
    portColor: [2, 2, 2],
    portRadius: 5,
    lodgings: [],
    lodgingColors: DEFAULT_LODGING_COLOR_CONFIG,
    lodgingRadius: 5,
    places: [],
    placeColors: DEFAULT_PLACE_COLOR_CONFIG,
    placeRadius: 5,
    extraLayers: [],
    routesVisible: ALL_ROUTES_VISIBLE,
    lite: false,
    ...over,
  });
}

describe("native hit mapping (forgejo#331)", () => {
  it("pins an airport at its own position", () => {
    const hit = resolveNativeHit(spec().targets, NATIVE_IDS.airports, 0)!;
    expect(pinnedFromHit(hit, [0, 0])).toEqual({
      kind: "airport",
      data: MUC,
      anchorLngLat: [11.78, 48.35],
    });
  });

  it("anchors a cruise path's card where the line was clicked, not at its middle", () => {
    const hit = resolveNativeHit(spec().targets, NATIVE_IDS.cruise, 0)!;
    const pinned = pinnedFromHit(hit, [8.4, 50.4]);
    expect(pinned?.kind).toBe("cruise");
    expect(pinned?.anchorLngLat).toEqual([8.4, 50.4]);
  });

  it("answers null for a lodging whose coordinates went missing, rather than pinning (0, 0)", () => {
    const hit = resolveNativeHit(
      spec({ lodgings: [{ id: "l", lat: 1, lon: 2 } as unknown as Lodging] }).targets,
      NATIVE_IDS.lodgings,
      0
    )!;
    expect(pinnedFromHit({ ...hit, object: { id: "l", lat: null, lon: null } }, [0, 0])).toBeNull();
  });

  it("resolves nothing for an unknown layer, a missing index or an index past the data", () => {
    const { targets } = spec();
    expect(resolveNativeHit(targets, "basemap-water", 0)).toBeNull();
    expect(resolveNativeHit(targets, NATIVE_IDS.airports, undefined)).toBeNull();
    expect(resolveNativeHit(targets, NATIVE_IDS.airports, 9)).toBeNull();
  });

  it("gives a caller's own line a hover but no card", () => {
    const line = new PathLayer({
      id: "dashboard-bus-paths",
      data: [
        {
          path: [
            [1, 1],
            [2, 2],
          ],
        },
      ],
      getPath: (d: { path: [number, number][] }) => d.path,
      widthUnits: "pixels",
      pickable: true,
    });
    const s = spec({ extraLayers: [line] });
    // Both the solid and the dashed variant of the line resolve to the same caller layer.
    for (const id of ["dashboard-bus-paths", "dashboard-bus-paths-dashed"]) {
      const hit = resolveNativeHit(s.targets, id, 0)!;
      expect(hit.kind).toBe("extra");
      expect(hit.deckId).toBe("dashboard-bus-paths");
      expect(pinnedFromHit(hit, [0, 0])).toBeNull();
    }
  });
});

describe("dispatchNativeHover", () => {
  function handlers(): NativeHoverHandlers {
    return { airport: vi.fn(), port: vi.fn(), cruise: vi.fn(), pin: vi.fn() };
  }

  it("routes each kind to the tooltip that renders it, with the pointer position", () => {
    const h = handlers();
    const { targets } = spec();
    dispatchNativeHover(resolveNativeHit(targets, NATIVE_IDS.airports, 0)!, 10, 20, h);
    dispatchNativeHover(resolveNativeHit(targets, NATIVE_IDS.cruise, 0)!, 30, 40, h);
    expect(h.airport).toHaveBeenCalledWith(expect.objectContaining({ object: MUC, x: 10, y: 20 }));
    expect(h.cruise).toHaveBeenCalledWith(
      expect.objectContaining({ object: expect.objectContaining({ cruiseId: "c1" }), x: 30, y: 40 })
    );
    expect(h.pin).not.toHaveBeenCalled();
  });

  it("names the deck.gl layer id on a pin's hover, which the shared tooltip renderer keys on", () => {
    const h = handlers();
    const s = spec({ lodgings: [{ id: "l", lat: 1, lon: 2 } as unknown as Lodging] });
    dispatchNativeHover(resolveNativeHit(s.targets, NATIVE_IDS.lodgings, 0)!, 1, 2, h);
    expect(h.pin).toHaveBeenCalledWith(
      expect.objectContaining({ layer: { id: "globe-lodging-pins" } })
    );
  });

  it("lets a caller's layer keep its own onHover, as it had under deck.gl", () => {
    const own = vi.fn();
    const line = new PathLayer({
      id: "dashboard-bus-paths",
      data: [
        {
          path: [
            [1, 1],
            [2, 2],
          ],
        },
      ],
      getPath: (d: { path: [number, number][] }) => d.path,
      widthUnits: "pixels",
      pickable: true,
      onHover: own,
    });
    const h = handlers();
    const s = spec({ extraLayers: [line] });
    dispatchNativeHover(resolveNativeHit(s.targets, "dashboard-bus-paths", 0)!, 1, 2, h);
    expect(own).toHaveBeenCalledTimes(1);
    expect(h.pin).not.toHaveBeenCalled();
  });
});
