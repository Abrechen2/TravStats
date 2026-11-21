import { describe, expect, it } from "vitest";
import {
  dayState,
  dimFirst,
  emphasisColor,
  emphasisWidth,
  pickSequenceItems,
  NUMBERS_MIN_ZOOM,
} from "../tripMapEmphasis";
import { buildMercatorTripLayers } from "../tripMapMercatorLayers";
import type { TripLabelItem } from "../tripMapLabels";

const item = (seq: number, lon: number, dim = false): TripLabelItem => ({
  position: [lon, 45],
  text: `S${seq}`,
  kind: "stop",
  seq,
  dim,
});

describe("forgejo#424 day emphasis", () => {
  it("states: nothing is dim or active until a day is chosen", () => {
    expect(dayState(true, false)).toBe("normal");
    expect(dayState(false, true)).toBe("active");
    expect(dayState(true, true)).toBe("dim");
  });

  it("a dimmed colour is desaturated grey and much fainter, not the same hue at lower alpha", () => {
    const [r, g, b, a] = emphasisColor([0, 180, 160], "dim", 255);
    expect(a).toBeLessThan(100);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(40);
    expect(emphasisColor([0, 180, 160], "active", 255)).toEqual([0, 180, 160, 255]);
  });

  it("the chosen day is wider than normal, the rest thinner", () => {
    expect(emphasisWidth(3, "active")).toBeGreaterThan(emphasisWidth(3, "normal"));
    expect(emphasisWidth(3, "dim")).toBeLessThan(emphasisWidth(3, "normal"));
  });

  it("dimmed entries sort first so the chosen day is drawn on top", () => {
    const out = dimFirst([{ id: "a" }, { id: "b", dim: true }, { id: "c" }]);
    expect(out.map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("numbers are hidden at low zoom while no day is chosen", () => {
    const items = [item(1, 10), item(2, 11)];
    expect(pickSequenceItems(items, NUMBERS_MIN_ZOOM - 1, false)).toEqual([]);
    expect(pickSequenceItems(items, NUMBERS_MIN_ZOOM + 3, false)).toHaveLength(2);
  });

  it("overlapping numbers are thinned, earliest kept", () => {
    const items = [item(1, 10), item(2, 10.0001), item(3, 10.0002)];
    const out = pickSequenceItems(items, 8, false);
    expect(out.map((i) => i.seq)).toEqual([1]);
  });

  it("with a day chosen only that day's numbers show, even when zoomed out", () => {
    const items = [item(1, 10, true), item(2, 20)];
    expect(pickSequenceItems(items, 3, true).map((i) => i.seq)).toEqual([2]);
  });

  it("the flat map's stops layer paints a dimmed stop grey and a chosen one in colour", () => {
    const stop = (dim: boolean) => ({
      position: [10, 45] as [number, number],
      color: [0, 180, 160] as [number, number, number],
      radiusMeters: 1000,
      label: "S",
      kind: "stop" as const,
      dim,
    });
    const layers = buildMercatorTripLayers({
      flightArcs: [],
      cruisePaths: [],
      tourPathData: [],
      airportPoints: [],
      stopPoints: [stop(false), stop(true)],
      lodgings: [],
      dimLodgingIds: new Set(),
      lodgingColors: {} as never,
      labelItems: [],
      directionLines: [],
      zoom: 8,
      dayChosen: true,
    });
    const stops = layers.find((l) => l.id === "trip-stops");
    const props = stops?.props as unknown as {
      data: { dim: boolean }[];
      getFillColor: (d: unknown) => number[];
    };
    expect(props.data[0].dim).toBe(true); // drawn first, under the live one
    expect(props.getFillColor(props.data[0])[3]).toBeLessThan(100);
    expect(props.getFillColor(props.data[1])).toEqual([0, 180, 160, 230]);
  });
});
