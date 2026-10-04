import { describe, it, expect } from "vitest";
import { placeSubtitle } from "../placeNames";

/** forgejo#199: the trip timeline's line under a place's name. */
describe("placeSubtitle", () => {
  it("puts the name on the sign before where the place is", () => {
    expect(placeSubtitle({ localName: "서울역", city: "Seoul", country: "South Korea" })).toBe(
      "서울역 · Seoul, South Korea"
    );
  });

  it("drops whichever half is missing", () => {
    expect(placeSubtitle({ localName: null, city: "Rom", country: "Italien" })).toBe(
      "Rom, Italien"
    );
    expect(placeSubtitle({ localName: "반포대교", city: null, country: null })).toBe("반포대교");
    expect(placeSubtitle({ city: null, country: null })).toBe("");
  });
});
