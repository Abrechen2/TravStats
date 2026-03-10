import { describe, it, expect } from "vitest";
import { getHeatmapColor, calcQuantiles, HEATMAP_COLORS } from "../../components/layers/layerTypes";

describe("calcQuantiles", () => {
  it("returns correct quantiles for even distribution", () => {
    const result = calcQuantiles([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.q25).toBe(2);
    expect(result.q50).toBe(4);
    expect(result.q75).toBe(6);
  });

  it("handles single-element array", () => {
    const result = calcQuantiles([5]);
    expect(result.q25).toBe(5);
    expect(result.q50).toBe(5);
    expect(result.q75).toBe(5);
  });
});

describe("getHeatmapColor", () => {
  it("returns low color for count <= q25", () => {
    expect(getHeatmapColor(1, 2, 5, 10)).toEqual(HEATMAP_COLORS.low);
  });

  it("returns medium color for q25 < count <= q50", () => {
    expect(getHeatmapColor(3, 2, 5, 10)).toEqual(HEATMAP_COLORS.medium);
  });

  it("returns high color for q50 < count <= q75", () => {
    expect(getHeatmapColor(7, 2, 5, 10)).toEqual(HEATMAP_COLORS.high);
  });

  it("returns critical color for count > q75", () => {
    expect(getHeatmapColor(15, 2, 5, 10)).toEqual(HEATMAP_COLORS.critical);
  });
});
