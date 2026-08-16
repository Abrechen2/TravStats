import { describe, it, expect } from "vitest";
import { hoverCursor, applyHoverCursor } from "../mapCursor";

function fakeMap(initial = ""): { getCanvas: () => { style: { cursor: string } } } {
  const canvas = { style: { cursor: initial } };
  return { getCanvas: () => canvas };
}

describe("hoverCursor", () => {
  it("shows a hand over a clickable object", () => {
    expect(hoverCursor(true)).toBe("pointer");
  });

  it("hands the cursor back to MapLibre when nothing is under the pointer", () => {
    // NOT "grab": MapLibre owns grab/grabbing while panning, and writing our
    // own value would stick mid-drag.
    expect(hoverCursor(false)).toBe("");
  });
});

describe("applyHoverCursor", () => {
  it("writes onto the MapLibre canvas, which is the one that is visible", () => {
    const map = fakeMap();
    applyHoverCursor(map, true);
    expect(map.getCanvas().style.cursor).toBe("pointer");

    applyHoverCursor(map, false);
    expect(map.getCanvas().style.cursor).toBe("");
  });

  it("does nothing before the map ref settles", () => {
    expect(() => applyHoverCursor(null, true)).not.toThrow();
    expect(() => applyHoverCursor(undefined, true)).not.toThrow();
  });
});
