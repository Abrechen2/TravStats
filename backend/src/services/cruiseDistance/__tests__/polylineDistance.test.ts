import { polylineDistanceKm } from "../polylineDistance";

describe("polylineDistanceKm", () => {
  it("sums the great-circle length of each segment", () => {
    // A 1° east step then a 1° north step — deliberately non-collinear, so a
    // bug that only measured first-to-last would land far outside this
    // bracket instead of accidentally passing.
    // AB (equator, 1° east) ~111.195 km, BC (1° north at lon=1°) ~111.195 km,
    // segment sum ~222.390 km. The direct first-to-last distance from
    // (0,0) to (1,1) is ~157.250 km — well outside (220, 224).
    const km = polylineDistanceKm([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    expect(km).toBeGreaterThan(220);
    expect(km).toBeLessThan(224);
  });

  it("reads pairs as [lon, lat], not [lat, lon]", () => {
    // Hamburg (9.99 E, 53.55 N) to Lisbon (-9.14 E, 38.72 N) is ~2200 km.
    // Read the other way round the same numbers land in the Indian Ocean and
    // the result is nowhere near that.
    const km = polylineDistanceKm([
      [9.99, 53.55],
      [-9.14, 38.72],
    ]);
    expect(km).toBeGreaterThan(2000);
    expect(km).toBeLessThan(2400);
  });

  it("returns 0 for a single point or an empty list", () => {
    expect(polylineDistanceKm([])).toBe(0);
    expect(polylineDistanceKm([[10, 50]])).toBe(0);
  });

  it("is the sum of its parts, so a split changes nothing", () => {
    const whole = polylineDistanceKm([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    const first = polylineDistanceKm([
      [0, 0],
      [1, 1],
    ]);
    const rest = polylineDistanceKm([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    // This is the property the whole feature rests on: cutting a route at a
    // point must not change its total length.
    expect(whole).toBeCloseTo(first + rest, 9);
  });
});
