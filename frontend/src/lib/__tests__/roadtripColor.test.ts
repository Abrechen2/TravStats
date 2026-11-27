import { describe, it, expect } from "vitest";
import {
  paletteColorForRoadtrip,
  roadtripColorModeFromStored,
  roadtripLineHex,
} from "../roadtripColor";
import { LIST_PALETTE_HEX } from "../listPalette";

describe("roadtrip colour (GitHub #408)", () => {
  it("single mode draws every roadtrip in the domain colour, even one with a colour of its own", () => {
    expect(roadtripLineHex("single", { id: "a", color: "#ef4444" }, "#112233")).toBe("#112233");
    expect(roadtripLineHex("single", { id: "b" }, "#112233")).toBe("#112233");
  });

  it("per-roadtrip mode gives a roadtrip the same palette colour on every call", () => {
    const first = roadtripLineHex("perRoadtrip", { id: "trip-1" }, "#112233");
    expect(roadtripLineHex("perRoadtrip", { id: "trip-1" }, "#999999")).toBe(first);
    expect(LIST_PALETTE_HEX).toContain(first);
  });

  it("per-roadtrip mode really varies: many ids use more than one colour", () => {
    const used = new Set(
      Array.from({ length: 30 }, (_, i) => paletteColorForRoadtrip(`roadtrip-${i}`))
    );
    expect(used.size).toBeGreaterThan(5);
  });

  it("a colour saved on the roadtrip wins over the palette; a malformed one is ignored", () => {
    expect(roadtripLineHex("perRoadtrip", { id: "a", color: "#ef4444" }, "#112233")).toBe(
      "#ef4444"
    );
    expect(roadtripLineHex("perRoadtrip", { id: "a", color: "red" }, "#112233")).toBe(
      paletteColorForRoadtrip("a")
    );
    expect(roadtripLineHex("perRoadtrip", { id: "a", color: null }, "#112233")).toBe(
      paletteColorForRoadtrip("a")
    );
  });

  it("an unknown stored mode is the single-colour default", () => {
    expect(roadtripColorModeFromStored(undefined)).toBe("single");
    expect(roadtripColorModeFromStored("rainbow")).toBe("single");
    expect(roadtripColorModeFromStored("perRoadtrip")).toBe("perRoadtrip");
  });
});
