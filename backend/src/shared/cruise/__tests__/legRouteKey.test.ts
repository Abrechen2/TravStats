import { buildLegRouteOverrideMap, legRouteKey, portLegRouteKey } from "../legRouteKey";

describe("legRouteKey", () => {
  it("is directional — swapping from/to changes the key", () => {
    expect(portLegRouteKey(1, 2)).not.toBe(portLegRouteKey(2, 1));
  });

  it("matches the generic key builder for the port kind", () => {
    expect(portLegRouteKey(1, 2)).toBe(legRouteKey("port", "1", "port", "2"));
  });
});

describe("buildLegRouteOverrideMap", () => {
  it("skips a row whose waypoints is not an array", () => {
    const map = buildLegRouteOverrideMap([
      { fromKind: "port", fromRef: "1", toKind: "port", toRef: "2", waypoints: { not: "an array" } },
      { fromKind: "port", fromRef: "3", toKind: "port", toRef: "4", waypoints: null },
      { fromKind: "port", fromRef: "5", toKind: "port", toRef: "6", waypoints: "also not an array" },
    ]);
    expect(map.size).toBe(0);
  });

  it("lands a valid polyline under the key its four endpoint fields describe", () => {
    const waypoints: Array<[number, number]> = [
      [9.99, 53.55],
      [-9.14, 38.72],
    ];
    const map = buildLegRouteOverrideMap([
      { fromKind: "port", fromRef: "1", toKind: "port", toRef: "2", waypoints },
    ]);
    expect(map.get(portLegRouteKey(1, 2))).toEqual(waypoints);
  });

  it("lands two rows with different endpoints under different keys", () => {
    const lineA: Array<[number, number]> = [
      [1, 1],
      [2, 2],
    ];
    const lineB: Array<[number, number]> = [
      [3, 3],
      [4, 4],
    ];
    const map = buildLegRouteOverrideMap([
      { fromKind: "port", fromRef: "1", toKind: "port", toRef: "2", waypoints: lineA },
      { fromKind: "port", fromRef: "9", toKind: "port", toRef: "10", waypoints: lineB },
    ]);
    expect(map.size).toBe(2);
    expect(map.get(portLegRouteKey(1, 2))).toEqual(lineA);
    expect(map.get(portLegRouteKey(9, 10))).toEqual(lineB);
  });
});
