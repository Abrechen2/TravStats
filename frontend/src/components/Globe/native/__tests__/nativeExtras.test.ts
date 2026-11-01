import { describe, it, expect } from "vitest";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import { bridgeExtraLayers } from "../nativeExtras";

type PathDatum = {
  path: [number, number, number?][];
  color: [number, number, number];
  dashed?: boolean;
};

const path = (over: Record<string, unknown> = {}) =>
  new PathLayer<PathDatum>({
    id: "dashboard-rail-paths",
    data: [
      {
        path: [
          [10, 50, 5000],
          [11, 51, 5000],
        ],
        color: [10, 20, 30],
      },
      {
        path: [
          [170, 0],
          [-170, 0],
        ],
        color: [1, 2, 3],
        dashed: true,
      },
    ],
    getPath: (d: PathDatum) => d.path as [number, number][],
    getColor: (d: PathDatum) => [...d.color, 170] as [number, number, number, number],
    getWidth: 3,
    widthUnits: "pixels",
    widthMinPixels: 1,
    ...over,
  } as ConstructorParameters<typeof PathLayer<PathDatum>>[0]);

describe("bridgeExtraLayers (forgejo#331)", () => {
  it("evaluates a pixel-width PathLayer's accessors into native line features, dropping altitude", () => {
    const { bridged, remaining } = bridgeExtraLayers([path()]);
    expect(remaining).toHaveLength(0);
    expect(bridged).toHaveLength(1);
    const [rail] = bridged;
    expect(rail.kind).toBe("line");
    expect(rail.id).toBe("dashboard-rail-paths");
    const first = rail.fc.features[0];
    expect(first.properties).toMatchObject({ i: 0, c: "rgba(10,20,30,0.667)", w: 3, d: 0 });
    expect((first.geometry as { coordinates: number[][] }).coordinates).toEqual([
      [10, 50],
      [11, 51],
    ]);
  });

  it("cuts a line that crosses the anti-meridian instead of drawing it round the world", () => {
    const { bridged } = bridgeExtraLayers([path()]);
    const pieces = bridged[0].fc.features.filter((f) => (f.properties as { i: number }).i === 1);
    expect(pieces).toHaveLength(2);
  });

  it("marks a dashed datum, so it lands on the dashed layer", () => {
    const dashed = path({
      extensions: [new PathStyleExtension({ dash: true })],
      getDashArray: (d: PathDatum) => (d.dashed ? [4, 2] : [0, 0]),
    });
    const flags = bridgeExtraLayers([dashed]).bridged[0].fc.features.map(
      (f) => (f.properties as { d: number }).d
    );
    expect(flags.slice(0, 1)).toEqual([0]);
    expect(flags).toContain(1);
  });

  it("applies the layer's min/max width clamp, as deck.gl would", () => {
    const wide = path({ getWidth: 40, widthMaxPixels: 6 });
    expect(
      (bridgeExtraLayers([wide]).bridged[0].fc.features[0].properties as { w: number }).w
    ).toBe(6);
  });

  it("turns a pixel-radius ScatterplotLayer into native dots with fill, ring and radius", () => {
    const dots = new ScatterplotLayer<{ at: [number, number] }>({
      id: "dashboard-rail-stations",
      data: [{ at: [8, 50] }],
      getPosition: (d) => d.at,
      getFillColor: [1, 2, 3, 255],
      getLineColor: [9, 9, 9, 255],
      getLineWidth: 2,
      stroked: true,
      radiusUnits: "pixels",
      getRadius: 4,
      pickable: true,
    });
    const { bridged } = bridgeExtraLayers([dots]);
    expect(bridged[0].kind).toBe("point");
    expect(bridged[0].pickable).toBe(true);
    expect(bridged[0].fc.features[0].properties).toMatchObject({
      f: "rgba(1,2,3,1)",
      s: "rgba(9,9,9,1)",
      sw: 2,
      r: 4,
    });
  });

  it("hands back what it cannot draw natively: metre units, other layer types", () => {
    const meters = path({ widthUnits: "meters" });
    const heat = new HeatmapLayer({ id: "heat", data: [], getPosition: () => [0, 0] });
    const { bridged, remaining } = bridgeExtraLayers([meters, heat]);
    expect(bridged).toHaveLength(0);
    expect(remaining.map((l) => l.id)).toEqual(["dashboard-rail-paths", "heat"]);
  });

  it("falls back to deck.gl, rather than losing the layer, when an accessor throws", () => {
    const broken = path({
      getColor: () => {
        throw new Error("boom");
      },
    });
    const { bridged, remaining } = bridgeExtraLayers([broken]);
    expect(bridged).toHaveLength(0);
    expect(remaining).toHaveLength(1);
  });

  it("drops a layer the caller hid", () => {
    const { bridged, remaining } = bridgeExtraLayers([path({ visible: false })]);
    expect(bridged).toHaveLength(0);
    expect(remaining).toHaveLength(0);
  });
});
