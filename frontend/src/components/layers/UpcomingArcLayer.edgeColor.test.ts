import { describe, it, expect, vi, afterEach } from "vitest";
import { ArcLayer } from "@deck.gl/layers";
import { UpcomingArcLayer, edgeColorNeedsRebuild } from "./UpcomingArcLayer";

/**
 * The tip colour of a mixed route is compiled INTO the fragment shader
 * (`toGlslVec3` in the inject), not passed as a uniform. deck.gl calls
 * `getShaders()` only when it builds the model, so a new colour used to sit in
 * the props and never reach the screen — the tester's report of 2026-09-20:
 * "Farbe für 'geplant' aktualisiert sich erst nach refresh der Seite oder
 * einem Wechsel auf 'frequenz' und wieder zurück zu 'status'. Farbe für
 * 'geflogen' aktualisiert sich sofort beim klick." Both of his workarounds
 * rebuild the layer; the flown colour travels in the arc data and never had
 * the problem.
 *
 * None of this can be checked against a real GPU here, so the two halves are
 * measured separately: that the colour is baked at all, and that a stale bake
 * triggers the rebuild.
 */

/**
 * `getShaders()` reads `this.context.defaultShaderModules`, which deck.gl only
 * fills once the layer is mounted. An empty list is enough to get the SOURCE
 * out — same helper as `routesLayer.greatCircle.test.ts`.
 */
function shadersOf(layer: ArcLayer): { inject?: Record<string, string> } {
  (layer as unknown as { context: unknown }).context = { defaultShaderModules: [] };
  return layer.getShaders();
}

function bakedOf(layer: UpcomingArcLayer): readonly [number, number, number] {
  return (layer as unknown as { bakedEdgeColor: readonly [number, number, number] }).bakedEdgeColor;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("edgeColorNeedsRebuild", () => {
  it("is false for the same colour arriving as a fresh array", () => {
    // `resolveFlightTipColor` builds a new array on every call, so identity
    // would report a change on every render and rebuild the model each frame.
    expect(edgeColorNeedsRebuild([255, 128, 0], [255, 128, 0])).toBe(false);
  });

  it("is true once any channel moves", () => {
    expect(edgeColorNeedsRebuild([255, 128, 0], [255, 128, 1])).toBe(true);
  });
});

describe("UpcomingArcLayer bakes the tip colour", () => {
  it("writes the normalised colour into the injected GLSL", () => {
    const layer = new UpcomingArcLayer({ edgeColor: [255, 0, 51] });
    const inject = (shadersOf(layer).inject ?? {})["fs:DECKGL_FILTER_COLOR"] ?? "";
    expect(inject).toContain("vec3(1.0000, 0.0000, 0.2000)");
  });

  it("records what it baked, so a later prop change is comparable", () => {
    const layer = new UpcomingArcLayer({ edgeColor: [255, 0, 51] });
    shadersOf(layer);
    expect(bakedOf(layer)).toEqual([255, 0, 51]);
  });
});

describe("UpcomingArcLayer.updateState", () => {
  /**
   * `ArcLayer.updateState` and `_getModel` both need a GPU device, so the
   * parent call is stubbed out and the rebuild is counted. What is left
   * running is this layer's own decision, which is the thing under test.
   */
  function probe(edgeColor: [number, number, number]): {
    layer: UpcomingArcLayer;
    destroyed: () => number;
    rebuilt: () => number;
  } {
    vi.spyOn(ArcLayer.prototype, "updateState").mockImplementation(() => {});
    let rebuilt = 0;
    let destroyed = 0;
    const layer = new UpcomingArcLayer({ edgeColor });
    vi.spyOn(layer as unknown as { _getModel: () => unknown }, "_getModel").mockImplementation(
      () => {
        rebuilt += 1;
        return { destroy: () => {} };
      }
    );
    vi.spyOn(
      layer as unknown as { getAttributeManager: () => unknown },
      "getAttributeManager"
    ).mockReturnValue({ invalidateAll: () => {} });
    (layer as unknown as { state: unknown }).state = {
      model: {
        destroy: () => {
          destroyed += 1;
        },
      },
    };
    return { layer, destroyed: () => destroyed, rebuilt: () => rebuilt };
  }

  it("rebuilds the model when the planned colour changes", () => {
    const { layer, destroyed, rebuilt } = probe([255, 0, 51]);
    shadersOf(layer); // the mount-time compile
    (layer as unknown as { props: { edgeColor: [number, number, number] } }).props = {
      edgeColor: [0, 255, 0],
    };
    layer.updateState({} as never);
    expect(rebuilt(), "the stale shader was left in place").toBe(1);
    expect(destroyed()).toBe(1);
  });

  it("leaves the model alone when the colour is unchanged", () => {
    const { layer, rebuilt } = probe([255, 0, 51]);
    shadersOf(layer);
    (layer as unknown as { props: { edgeColor: [number, number, number] } }).props = {
      edgeColor: [255, 0, 51],
    };
    layer.updateState({} as never);
    expect(rebuilt()).toBe(0);
  });

  it("does nothing before a model exists — the first compile reads the props anyway", () => {
    const { layer, rebuilt } = probe([255, 0, 51]);
    (layer as unknown as { state: unknown }).state = {};
    (layer as unknown as { props: { edgeColor: [number, number, number] } }).props = {
      edgeColor: [0, 255, 0],
    };
    expect(() => layer.updateState({} as never)).not.toThrow();
    expect(rebuilt()).toBe(0);
  });
});
