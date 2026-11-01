import { describe, it, expect } from "vitest";
import { cssRgba, splitAtAntimeridian } from "../nativeGeo";

describe("splitAtAntimeridian (forgejo#331)", () => {
  it("leaves a path that never crosses ±180 as one piece", () => {
    expect(
      splitAtAntimeridian([
        [8, 50],
        [9, 51],
        [10, 52],
      ])
    ).toEqual([
      [
        [8, 50],
        [9, 51],
        [10, 52],
      ],
    ]);
  });

  it("cuts an eastbound crossing at +180 and resumes at -180 on the same latitude", () => {
    const pieces = splitAtAntimeridian([
      [170, 10],
      [-170, 30],
    ]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0][0]).toEqual([170, 10]);
    expect(pieces[0][1][0]).toBe(180);
    expect(pieces[1][0][0]).toBe(-180);
    // Halfway across the 20° gap: the latitude is the midpoint.
    expect(pieces[0][1][1]).toBeCloseTo(20, 6);
    expect(pieces[1][0][1]).toBeCloseTo(20, 6);
    expect(pieces[1][1]).toEqual([-170, 30]);
  });

  it("cuts a westbound crossing the other way round", () => {
    const pieces = splitAtAntimeridian([
      [-175, 0],
      [175, 10],
    ]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0][1][0]).toBe(-180);
    expect(pieces[1][0][0]).toBe(180);
  });

  it("treats a pre-unwrapped longitude (> 180) as the same point on the sphere", () => {
    // deck.gl waypoints stay monotone past 180; a native line must be wrapped.
    const pieces = splitAtAntimeridian([
      [178, 0],
      [182, 4],
    ]);
    expect(pieces).toHaveLength(2);
    expect(pieces[1][1][0]).toBeCloseTo(-178, 9);
  });

  it("drops non-finite points and pieces of one point", () => {
    expect(splitAtAntimeridian([[1, 1]])).toEqual([]);
    expect(
      splitAtAntimeridian([
        [1, 1],
        [Number.NaN, 2],
        [3, 3],
      ])
    ).toEqual([
      [
        [1, 1],
        [3, 3],
      ],
    ]);
  });
});

describe("cssRgba", () => {
  it("turns deck.gl's 0-255 alpha into a CSS fraction", () => {
    expect(cssRgba([10, 20, 30, 255])).toBe("rgba(10,20,30,1)");
    expect(cssRgba([10, 20, 30, 0])).toBe("rgba(10,20,30,0)");
    expect(cssRgba([10, 20, 30, 230])).toBe("rgba(10,20,30,0.902)");
  });

  it("defaults a three-channel colour to opaque", () => {
    expect(cssRgba([1, 2, 3])).toBe("rgba(1,2,3,1)");
  });
});
