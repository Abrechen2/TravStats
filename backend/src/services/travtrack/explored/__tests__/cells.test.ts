import {
  bboxRanges,
  cellsOfPoints,
  EXPLORED_ZOOM,
  inRanges,
  tileBounds,
  tileOf,
  type Bbox,
} from "../cells";

/**
 * The explored map's one resolution (TravTrack plan L1): Web-Mercator tiles at
 * zoom 14, the only cells stored and the only ones served.
 */

describe("explored cells", () => {
  it("is zoom 14", () => {
    expect(EXPLORED_ZOOM).toBe(14);
  });

  it("puts (0, 0) at the centre tile", () => {
    expect(tileOf(0.0001, 0.0001)).toEqual({ x: 8192, y: 8191 });
    expect(tileOf(-0.0001, -0.0001)).toEqual({ x: 8191, y: 8192 });
  });

  it("a position lies inside the bounds of its own tile", () => {
    for (const [lat, lon] of [
      [52.52, 13.405],
      [37.5665, 126.978],
      [-33.8688, 151.2093],
      [64.1466, -21.9426],
    ]) {
      const b = tileBounds(tileOf(lat, lon));
      expect(lat).toBeGreaterThanOrEqual(b.south);
      expect(lat).toBeLessThan(b.north);
      expect(lon).toBeGreaterThanOrEqual(b.west);
      expect(lon).toBeLessThan(b.east);
    }
  });

  it("clamps the poles and the antimeridian into the grid", () => {
    expect(tileOf(89.9, 180)).toEqual({ x: 16383, y: 0 });
    expect(tileOf(-89.9, -180)).toEqual({ x: 0, y: 16383 });
  });

  it("many points in one tile are one cell", () => {
    const cells = cellsOfPoints([
      { lat: 52.52, lon: 13.405 },
      { lat: 52.5201, lon: 13.4051 },
      { lat: 48.1372, lon: 11.5755 },
    ]);
    expect(cells).toHaveLength(2);
    expect(cells).toContainEqual(tileOf(52.52, 13.405));
    expect(cells).toContainEqual(tileOf(48.1372, 11.5755));
  });

  it("a bbox is one tile range, or two across the antimeridian", () => {
    const berlin: Bbox = { west: 13, south: 52, east: 14, north: 53 };
    const [range] = bboxRanges(berlin);
    expect(bboxRanges(berlin)).toHaveLength(1);
    expect(inRanges(tileOf(52.5, 13.4), [range])).toBe(true);
    expect(inRanges(tileOf(48.1, 11.5), [range])).toBe(false);

    const pacific = bboxRanges({ west: 170, south: -20, east: -170, north: 0 });
    expect(pacific).toHaveLength(2);
    expect(inRanges(tileOf(-10, 179), pacific)).toBe(true);
    expect(inRanges(tileOf(-10, -179), pacific)).toBe(true);
    expect(inRanges(tileOf(-10, 0), pacific)).toBe(false);
  });
});
