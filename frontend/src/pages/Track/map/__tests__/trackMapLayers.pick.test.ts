import { describe, expect, it } from "vitest";
import {
  LEG_PICK_WIDTH,
  LEG_PICK_WIDTH_COARSE,
  buildTrackLayers,
  nearestTime,
  type TrackLayerInput,
} from "../trackMapLayers";

const base = {
  layers: { routes: true },
  color: "plain",
  opacity: 1,
  lines: [],
  segments: [],
  points: [],
  anchors: [],
  replay: [],
  onPoint: () => {},
  photos: [],
  onPhoto: () => {},
  countries: [],
} as unknown as TrackLayerInput;

const line = {
  path: [
    [13.4, 52.5],
    [13.5, 52.6],
    [13.6, 52.7],
  ] as [number, number][],
  times: [100, 200, 300],
};

describe("picking a drawn route", () => {
  it("names the instant of the vertex nearest to the click", () => {
    expect(nearestTime(line, [13.51, 52.61])).toBe(200);
    expect(nearestTime(line, [13.39, 52.49])).toBe(100);
    expect(nearestTime({ path: [], times: [] }, [0, 0])).toBeNull();
  });

  it("a range line is a pickable layer whose hit width follows the pointer", () => {
    for (const width of [LEG_PICK_WIDTH, LEG_PICK_WIDTH_COARSE]) {
      const out = buildTrackLayers({
        ...base,
        rangeLines: [line],
        onRangePick: () => {},
        pickWidth: width,
      });
      const layer = out.find((l) => l.id === "track-range-pick");
      expect(layer).toBeDefined();
      expect((layer!.props as unknown as { pickable: boolean }).pickable).toBe(true);
      expect((layer!.props as unknown as { getWidth: number }).getWidth).toBe(width);
    }
    expect(LEG_PICK_WIDTH_COARSE).toBeGreaterThan(LEG_PICK_WIDTH);
  });
});
