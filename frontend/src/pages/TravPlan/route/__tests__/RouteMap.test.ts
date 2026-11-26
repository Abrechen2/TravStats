import { describe, it, expect } from "vitest";
import { markerGroups } from "../RouteMap";
import { place } from "./routeFixture";
import { newStation } from "../routeModel";

describe("markerGroups", () => {
  it("draws a place the route returns to as one marker carrying both numbers", () => {
    const palermo = place("Palermo", 38.1157, 13.3615);
    const stations = [
      newStation(place("Genova", 44.4, 8.9)),
      newStation(palermo),
      newStation(place("Cefalù", 38.04, 14.02)),
      newStation({ ...palermo, lat: 38.1158 }),
    ];
    expect(markerGroups(stations).map((g) => [g.station.title, g.numbers])).toEqual([
      ["Genova", [1]],
      ["Palermo", [2, 4]],
      ["Cefalù", [3]],
    ]);
  });
});
