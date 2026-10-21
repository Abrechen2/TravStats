import { describe, expect, it } from "vitest";
import { journeyFromBus, journeyFromFerry, journeyFromRail } from "../journeyNormalize";

/**
 * A card that prints "Strecke 85 km" for a straight line and "684 km" for an
 * estimated sea route passes both off as the way travelled. The source travels
 * with the figure, as on the detail and statistics pages.
 */

const ENDS = {
  depStationName: "Kiel",
  depLat: 54.32,
  depLon: 10.14,
  arrStationName: "Oslo",
  arrLat: 59.9,
  arrLon: 10.75,
};

describe("distance provenance", () => {
  it("keeps what a ride's distance measures", () => {
    const ferry = journeyFromFerry({
      id: "f3",
      status: "completed",
      ...ENDS,
      distanceKm: 684,
      distanceSource: "sea_route",
    } as Parameters<typeof journeyFromFerry>[0]);
    const rail = journeyFromRail({
      id: "r2",
      status: "completed",
      ...ENDS,
      distanceKm: 85,
      distanceSource: "great_circle",
    } as Parameters<typeof journeyFromRail>[0]);
    expect(ferry.distanceSource).toBe("sea_route");
    expect(rail.distanceSource).toBe("great_circle");
  });

  it("names no source for a distance nobody recorded", () => {
    const bus = journeyFromBus({
      id: "b2",
      status: "completed",
      ...ENDS,
      distanceKm: null,
      distanceSource: "great_circle",
    } as Parameters<typeof journeyFromBus>[0]);
    expect(bus.distanceSource).toBeNull();
  });
});

describe("distance source labels", () => {
  it("names each domain's source with the key its own pages use", async () => {
    const { distanceSourceKey } = await import("../journeyProvenance");
    expect(distanceSourceKey("rail", "great_circle")).toBe("rail:stats.sourceStraight");
    expect(distanceSourceKey("rail", "route")).toBe("rail:stats.sourceTraced");
    expect(distanceSourceKey("ferry", "sea_route")).toBe("ferry:distanceSource.sea_route");
    expect(distanceSourceKey("bus", "route")).toBe("bus:distanceSource.route");
    expect(distanceSourceKey("rental", "odometer")).toBe("rental:distance.odometer");
  });

  it("names nothing for an unknown or missing source rather than guessing", async () => {
    const { distanceSourceKey } = await import("../journeyProvenance");
    expect(distanceSourceKey("ferry", null)).toBeNull();
    expect(distanceSourceKey("ferry", "teleport")).toBeNull();
  });

  it("lists the distinct sources of the measured, travelled journeys", async () => {
    const { routeDistanceSourceKeys } = await import("../journeyProvenance");
    const a = journeyFromFerry({
      id: "a",
      status: "completed",
      ...ENDS,
      distanceKm: 684,
      distanceSource: "sea_route",
    } as Parameters<typeof journeyFromFerry>[0]);
    const b = journeyFromFerry({
      id: "b",
      status: "completed",
      ...ENDS,
      distanceKm: 690,
      distanceSource: "sea_route",
    } as Parameters<typeof journeyFromFerry>[0]);
    const c = journeyFromFerry({
      id: "c",
      status: "completed",
      ...ENDS,
      distanceKm: 600,
      distanceSource: "user",
    } as Parameters<typeof journeyFromFerry>[0]);
    expect(routeDistanceSourceKeys([a, b, c])).toEqual([
      "ferry:distanceSource.sea_route",
      "ferry:distanceSource.user",
    ]);
  });
});
