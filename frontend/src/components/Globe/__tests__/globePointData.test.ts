import { describe, it, expect } from "vitest";
import { buildAirportPoints, buildPortPoints } from "../globePointData";
import type { GeoJSONFeature } from "../../../types";
import type { Cruise } from "../../../types/cruise";
import type { CruiseLegDates } from "../timeSliderUtils";

/**
 * The two aggregations GlobeView used to hold inline. They carry counting
 * rules — a scheduled flight must not date a visit, and only a sailed cruise's
 * port calls are visits — which is exactly why they are worth a test now that
 * they can be called without mounting MapLibre.
 */

function flight(
  dep: string,
  arr: string,
  status: string,
  departureTime: string | null,
  coords: [number, number][] = [
    [8, 50],
    [13, 52],
  ]
): GeoJSONFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: {
      id: `${dep}-${arr}-${departureTime ?? "undated"}`,
      status,
      departureTime,
      departureAirport: { iata: dep, name: `${dep} Airport`, icao: `Z${dep}` },
      arrivalAirport: { iata: arr, name: `${arr} Airport`, icao: `Z${arr}` },
    },
  } as unknown as GeoJSONFeature;
}

describe("buildAirportPoints", () => {
  it("counts every flight that touched an airport, both ends", () => {
    const points = buildAirportPoints([
      flight("FRA", "BER", "flown", "2024-01-10T08:00:00Z"),
      flight("FRA", "BER", "flown", "2024-03-10T08:00:00Z"),
    ]);
    expect(points.map((p) => p.iata).sort()).toEqual(["BER", "FRA"]);
    expect(points.find((p) => p.iata === "FRA")?.size).toBe(2);
  });

  it("keeps the LATEST visit date, and never dates one from a scheduled flight", () => {
    const points = buildAirportPoints([
      flight("FRA", "BER", "flown", "2024-01-10T08:00:00Z"),
      flight("FRA", "BER", "flown", "2024-03-10T08:00:00Z"),
      flight("FRA", "BER", "scheduled", "2099-01-01T08:00:00Z"),
    ]);
    const fra = points.find((p) => p.iata === "FRA");
    // All three flights count toward `size`; only the two that happened may
    // date the visit — a future flight bumping "last visit" is the bug.
    expect(fra?.size).toBe(3);
    expect(fra?.lastVisit).toBe("2024-03-10T08:00:00Z");
  });

  it("skips a feature with no usable geometry", () => {
    const broken = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[8, 50]] },
      properties: { id: "x", status: "flown", departureAirport: { iata: "FRA" } },
    } as unknown as GeoJSONFeature;
    expect(buildAirportPoints([broken])).toEqual([]);
  });
});

function cruise(id: string, status: string): Cruise {
  return {
    id,
    status,
    startDate: "2024-06-01T00:00:00Z",
    stops: [
      {
        id: `${id}-s1`,
        dayNumber: 1,
        isAtSea: false,
        port: { id: 1, name: "Kiel", unlocode: "DEKEL", lat: 54.3, lon: 10.1, city: "Kiel" },
      },
      {
        id: `${id}-s2`,
        dayNumber: 2,
        isAtSea: false,
        port: { id: 2, name: "Oslo", unlocode: "NOOSL", lat: 59.9, lon: 10.7, city: "Oslo" },
      },
      { id: `${id}-s3`, dayNumber: 3, isAtSea: true, port: null },
    ],
  } as unknown as Cruise;
}

const LEGS: ReadonlyMap<string, CruiseLegDates[]> = new Map([
  [
    "c1",
    [
      {
        cruiseId: "c1",
        fromPortId: 1,
        toPortId: 2,
        startDate: new Date("2024-06-01T00:00:00Z"),
        endDate: new Date("2024-06-02T00:00:00Z"),
      } as CruiseLegDates,
    ],
  ],
]);

const OPEN = { mode: "off", current: null, filterStart: null, filterEnd: null } as const;

describe("buildPortPoints", () => {
  it("draws a dot per port of a sailed cruise, and never a sea day", () => {
    const points = buildPortPoints([cruise("c1", "flown")], LEGS, OPEN);
    expect(points.map((p) => p.name).sort()).toEqual(["Kiel", "Oslo"]);
    // The readable label, not the raw UN/LOCODE — the code still rides along
    // on `iata` for the tooltip.
    expect(points.find((p) => p.name === "Oslo")?.label).toBe("Oslo");
    expect(points.find((p) => p.name === "Oslo")?.iata).toBe("NOOSL");
    expect(points.find((p) => p.name === "Oslo")?.country).toBe("NO");
  });

  it("ignores a cruise that has not sailed", () => {
    expect(buildPortPoints([cruise("c2", "scheduled")], LEGS, OPEN)).toEqual([]);
  });

  it("drops ports the live window has not reached yet", () => {
    const points = buildPortPoints([cruise("c1", "flown")], LEGS, {
      mode: "live",
      current: new Date("2024-06-01T12:00:00Z"),
      filterStart: null,
      filterEnd: null,
    });
    expect(points.map((p) => p.name)).toEqual(["Kiel"]);
  });

  it("keeps only ports inside the filter window", () => {
    const points = buildPortPoints([cruise("c1", "flown")], LEGS, {
      mode: "filter",
      current: null,
      filterStart: new Date("2024-06-02T00:00:00Z"),
      filterEnd: new Date("2024-06-03T00:00:00Z"),
    });
    expect(points.map((p) => p.name)).toEqual(["Oslo"]);
  });
});
