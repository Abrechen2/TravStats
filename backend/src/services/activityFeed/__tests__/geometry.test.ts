import { describe, it, expect } from "@jest/globals";
import { focusOf } from "../geometry";

describe("focusOf", () => {
  it("is a point for one place and a box for two", () => {
    expect(focusOf([{ lat: 1, lon: 2 }])).toEqual({ point: { lat: 1, lon: 2 }, bbox: null });
    expect(
      focusOf([
        { lat: 1, lon: 2 },
        { lat: 3, lon: 6 },
      ])
    ).toEqual({ point: null, bbox: [2, 1, 6, 3] });
  });

  it("does not fly to 0/0 for an unresolved coordinate", () => {
    expect(
      focusOf([
        { lat: 0, lon: 0 },
        { lat: null, lon: null },
      ])
    ).toEqual({
      point: null,
      bbox: null,
    });
    expect(
      focusOf([
        { lat: 0, lon: 0 },
        { lat: 5, lon: 5 },
      ]).point
    ).toEqual({ lat: 5, lon: 5 });
  });

  it("takes the short way round the antimeridian instead of a 250-degree box", () => {
    const tokyoLa = focusOf([
      { lat: 35.7, lon: 139.7 },
      { lat: 34.0, lon: -118.4 },
    ]);
    expect(tokyoLa.bbox).toEqual([139.7, 34.0, 241.6, 35.7]);
  });
});
