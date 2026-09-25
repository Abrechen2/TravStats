import { describe, it, expect } from "@jest/globals";

import {
  planRoadtripRailConversion,
  type RoadtripSectionInput,
  type RoadtripStopInput,
} from "../roadtripConversion";

const stop = (id: string, over: Partial<RoadtripStopInput> = {}): RoadtripStopInput => ({
  id,
  title: `Stop ${id}`,
  lat: 48,
  lon: 11,
  startDate: new Date("2025-07-01T00:00:00Z"),
  endDate: null,
  ...over,
});

const section = (over: Partial<RoadtripSectionInput> = {}): RoadtripSectionInput => ({
  id: "s1",
  userId: "u1",
  tripId: "t1",
  name: "Interrail 2025",
  notes: null,
  vehicle: "rail",
  vehicleName: "ÖBB",
  stops: [
    stop("a", { title: "München Hbf", endDate: new Date("2025-07-01T00:00:00Z") }),
    stop("b", { title: "Wien Hbf", startDate: new Date("2025-07-01T00:00:00Z") }),
    stop("c", { title: "Budapest-Keleti", startDate: new Date("2025-07-04T00:00:00Z") }),
  ],
  legs: [
    { fromStopId: "a", toStopId: "b", distanceKm: 355, source: "straight", waypoints: null },
    {
      fromStopId: "b",
      toStopId: "c",
      distanceKm: 250,
      source: "routed",
      waypoints: [
        [16.37, 48.18],
        [19.08, 47.5],
      ],
    },
  ],
  ...over,
});

/**
 * The contract for turning a roadtrip section "by rail" into rail journeys
 * (owner decision 1, rail spec). Pure, and written against main's columns by
 * name, because the roadtrip code is not on this branch yet.
 */
describe("planRoadtripRailConversion", () => {
  it("makes one journey per leg, not one per section", () => {
    const plan = planRoadtripRailConversion(section());
    expect(plan.journeys.map((j) => `${j.depStationName} → ${j.arrStationName}`)).toEqual([
      "München Hbf → Wien Hbf",
      "Wien Hbf → Budapest-Keleti",
    ]);
    expect(plan.journeys.every((j) => j.tripId === "t1" && j.operator === "ÖBB")).toBe(true);
  });

  it("keeps a straight leg straight and carries a routed leg's line", () => {
    const [straight, routed] = planRoadtripRailConversion(section()).journeys;
    expect(straight).toMatchObject({
      distanceSource: "great_circle",
      geometry: null,
      geometrySource: "straight",
    });
    expect(routed).toMatchObject({ distanceSource: "route", geometrySource: "manual" });
    expect(routed.geometry).toHaveLength(2);
  });

  it("places a day-only date at noon UTC and says so, never at an invented clock time", () => {
    const [first] = planRoadtripRailConversion(section()).journeys;
    expect(first.departureTime.toISOString()).toBe("2025-07-01T12:00:00.000Z");
    expect(first.notes).toContain("noon UTC");
  });

  it("skips a leg without a date or a position, with the reason", () => {
    const plan = planRoadtripRailConversion(
      section({
        stops: [stop("a", { startDate: null, endDate: null }), stop("b"), stop("c", { lat: null })],
      })
    );
    expect(plan.journeys).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["noDate", "noPosition"]);
  });

  it("converts nothing from a section that is not by rail", () => {
    const plan = planRoadtripRailConversion(section({ vehicle: "motorhome" }));
    expect(plan.journeys).toEqual([]);
    expect(plan.skipped.every((s) => s.reason === "notRail")).toBe(true);
  });
});
