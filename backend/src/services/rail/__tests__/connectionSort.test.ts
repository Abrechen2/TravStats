import { describe, it, expect } from "@jest/globals";
import { sortConnections, type SortableLeg } from "../connectionSort";

const leg = (id: string, over: Partial<SortableLeg> = {}): SortableLeg => ({
  id,
  departureTime: new Date("2025-01-01T08:00:00Z"),
  arrivalTime: new Date("2025-01-01T09:00:00Z"),
  depStationName: "A",
  arrStationName: "B",
  operator: null,
  distanceKm: null,
  status: "completed",
  trip: null,
  ...over,
});
const ids = (gs: SortableLeg[][]): string[] => gs.map((g) => g[0].id);

describe("sortConnections", () => {
  it("sinks an absent value last in BOTH directions, never first", () => {
    const groups = [
      [leg("a", { operator: null })],
      [leg("b", { operator: "DB" })],
      [leg("c", { operator: "SNCF" })],
    ];
    expect(ids(sortConnections(groups, "operator", "asc"))).toEqual(["b", "c", "a"]);
    expect(ids(sortConnections(groups, "operator", "desc"))).toEqual(["c", "b", "a"]);
  });

  it("sums the distance over a connection's legs", () => {
    const groups = [
      [leg("a", { distanceKm: 100 })],
      [leg("b", { distanceKm: 70 }), leg("b2", { distanceKm: 70 })],
    ];
    expect(ids(sortConnections(groups, "distance", "desc"))).toEqual(["b", "a"]);
  });

  it("treats a ride with an unmeasured leg as having no known distance", () => {
    const groups = [
      [leg("a", { distanceKm: 500 })],
      [leg("b", { distanceKm: 10 }), leg("b2", { distanceKm: null })],
    ];
    expect(ids(sortConnections(groups, "distance", "asc"))).toEqual(["a", "b"]);
  });

  it("reads a connection's duration from first departure to last arrival", () => {
    const long = [
      leg("l1", { arrivalTime: new Date("2025-01-01T08:30:00Z") }),
      leg("l2", {
        departureTime: new Date("2025-01-01T08:40:00Z"),
        arrivalTime: new Date("2025-01-01T12:00:00Z"),
      }),
    ];
    expect(ids(sortConnections([[leg("s")], long], "duration", "desc"))).toEqual(["l1", "s"]);
  });

  it("breaks ties totally so equal keys keep a stable, repeatable order", () => {
    const groups = [[leg("b")], [leg("a")], [leg("c")]];
    expect(ids(sortConnections(groups, "status", "asc"))).toEqual(["a", "b", "c"]);
    expect(ids(sortConnections([...groups].reverse(), "status", "asc"))).toEqual(["a", "b", "c"]);
  });
});
