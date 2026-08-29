import {
  createRouteSchema,
  updateRouteSchema,
  assignStopsSchema,
  legOverrideSchema,
} from "../schemas/tour";

describe("createRouteSchema", () => {
  it("accepts a minimal section", () => {
    expect(createRouteSchema.parse({ name: "Südnorwegen", mode: "road" })).toMatchObject({
      name: "Südnorwegen",
      mode: "road",
    });
  });

  it("rejects a mode that is not a transport mode", () => {
    expect(() => createRouteSchema.parse({ name: "X", mode: "hotel" })).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => createRouteSchema.parse({ name: "", mode: "road" })).toThrow();
  });
});

describe("assignStopsSchema", () => {
  it("accepts an ordered id list, including a repeated stop for a loop", () => {
    const parsed = assignStopsSchema.parse({ stopIds: ["a", "b", "a"] });
    expect(parsed.stopIds).toEqual(["a", "b", "a"]);
  });

  it("accepts an empty list — that releases every stop", () => {
    expect(assignStopsSchema.parse({ stopIds: [] }).stopIds).toEqual([]);
  });

  it("rejects a list longer than the cap", () => {
    expect(() => assignStopsSchema.parse({ stopIds: Array(513).fill("a") })).toThrow();
  });
});

describe("legOverrideSchema", () => {
  const line: Array<[number, number]> = [
    [10.75, 59.91],
    [11.97, 57.71],
  ];

  it("accepts a drawn line", () => {
    expect(legOverrideSchema.parse({ source: "drawn", waypoints: line }).source).toBe("drawn");
  });

  it("requires at least two points for a drawn line", () => {
    expect(() => legOverrideSchema.parse({ source: "drawn", waypoints: [[10.75, 59.91]] })).toThrow();
  });

  it("rejects coordinates outside the world", () => {
    expect(() =>
      legOverrideSchema.parse({ source: "drawn", waypoints: [[200, 59.91], [11.97, 57.71]] }),
    ).toThrow();
  });

  it("rejects waypoints on a straight leg — a straight leg has no line", () => {
    expect(() => legOverrideSchema.parse({ source: "straight", waypoints: line })).toThrow();
  });

  it("accepts a straight leg with no waypoints", () => {
    expect(legOverrideSchema.parse({ source: "straight" }).source).toBe("straight");
  });
});

describe("updateRouteSchema", () => {
  it("allows clearing the odometer readings", () => {
    expect(updateRouteSchema.parse({ startOdometerKm: null }).startOdometerKm).toBeNull();
  });

  it("rejects a negative odometer reading", () => {
    expect(() => updateRouteSchema.parse({ startOdometerKm: -1 })).toThrow();
  });
});
