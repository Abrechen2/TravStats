// forgejo#352: live playback aggregates the arcs ONCE and hides the unflown
// ones on the GPU. A GPU filter cannot recount, so every number a person reads
// must still be right for the cursor's moment.

import { describe, expect, it } from "vitest";
import { buildGlobeArcData } from "../globeArcData";
import { arcAtTime, countVisibleRoutes, gpuMinute } from "../arcTimeline";
import { computeGlobeLiveStats } from "../liveGlobeData";
import { buildGlobeLayers } from "../buildGlobeLayers";
import type { GeoJSONFeature } from "../../../types";

const flight = (
  id: string,
  from: [string, number, number],
  to: [string, number, number],
  departureTime: string,
  status = "flown"
) =>
  ({
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [from[1], from[2]],
        [to[1], to[2]],
      ],
    },
    properties: {
      id,
      status,
      departureTime,
      departureAirport: { iata: from[0], name: from[0] },
      arrivalAirport: { iata: to[0], name: to[0] },
    },
  }) as unknown as GeoJSONFeature;

const FRA: [string, number, number] = ["FRA", 8.57, 50.03];
const JFK: [string, number, number] = ["JFK", -73.78, 40.64];
const MUC: [string, number, number] = ["MUC", 11.79, 48.35];
const day = (d: number) => Date.UTC(2024, 0, d);
const iso = (d: number) => new Date(day(d)).toISOString();

// Deliberately out of order: the timeline must sort, not trust input order.
const FLIGHTS = [
  flight("c", FRA, JFK, iso(20)),
  flight("a", FRA, JFK, iso(2)),
  flight("m", MUC, JFK, iso(10), "scheduled"),
  flight("b", FRA, JFK, iso(8)),
];

describe("live playback timeline", () => {
  it("shows a route from its first flight, and from the minRouteCount-th when a minimum is set", () => {
    const one = buildGlobeArcData(FLIGHTS, 1, false, 1, undefined, true).arcsData;
    expect(one.find((a) => a.departure.iata === "FRA")?.visibleFrom).toBe(day(2));
    expect(one.find((a) => a.departure.iata === "MUC")?.visibleFrom).toBe(day(10));
    const two = buildGlobeArcData(FLIGHTS, 2, false, 1, undefined, true).arcsData;
    expect(two).toHaveLength(1);
    expect(two[0].visibleFrom).toBe(day(8));
  });

  it("recounts a route as of the cursor instead of reporting the whole logbook", () => {
    const fra = buildGlobeArcData(FLIGHTS, 1, false, 1, undefined, true).arcsData.find(
      (a) => a.departure.iata === "FRA"
    )!;
    expect(fra.count).toBe(3);
    expect(fra.flightIds).toEqual(["a", "b", "c"]);
    const mid = arcAtTime(fra, day(9));
    expect(mid.count).toBe(2);
    expect(mid.flightIds).toEqual(["a", "b"]);
    expect(mid.flownCount).toBe(2);
    expect(arcAtTime(fra, day(30))).toBe(fra);
    expect(arcAtTime(fra, null)).toBe(fra);
  });

  it("recounts a recorded line's route count too, without swapping its own flight (Codex review)", () => {
    const { arcsData } = buildGlobeArcData(FLIGHTS, 1, false, 1, undefined, true);
    const base = arcsData.find((a) => a.departure.iata === "FRA")!;
    const recorded = {
      ...base,
      recorded: "solid" as const,
      flightIds: ["b"],
      visibleFrom: day(8),
    };
    const at = arcAtTime(recorded, day(9));
    expect(at.count).toBe(2);
    expect(at.flightIds).toEqual(["b"]);
  });

  it("splits flown from scheduled as of the cursor", () => {
    const flights = [
      flight("a", FRA, JFK, iso(2)),
      flight("b", FRA, JFK, iso(8), "scheduled"),
      flight("c", FRA, JFK, iso(12), "scheduled"),
    ];
    const fra = buildGlobeArcData(flights, 1, false, 1, undefined, true).arcsData[0];
    const at = arcAtTime(fra, day(9));
    expect([at.count, at.flownCount, at.scheduledCount]).toEqual([2, 1, 1]);
    expect(arcAtTime(fra, day(1)).count).toBe(0);
  });

  it("counts the routes shown on the stats card as of the cursor, not the arrays' length", () => {
    const { arcsData, antipodalArcs } = buildGlobeArcData(FLIGHTS, 1, false, 1, undefined, true);
    expect(countVisibleRoutes(arcsData, day(1))).toBe(0);
    expect(countVisibleRoutes(arcsData, day(5))).toBe(1);
    expect(countVisibleRoutes(arcsData, day(10))).toBe(2);
    const visible = FLIGHTS.filter((f) => Date.parse(f.properties.departureTime!) <= day(5));
    const stats = computeGlobeLiveStats(visible, [], [], [], arcsData, antipodalArcs, day(5));
    expect(stats.routes).toBe(1);
    expect(stats.flights).toBe(1);
  });

  it("leaves the non-live build untouched: no timeline, no GPU time", () => {
    const arcs = buildGlobeArcData(FLIGHTS, 1, false, 1).arcsData;
    expect(arcs.every((a) => a.visibleFrom === undefined && a.timeline === undefined)).toBe(true);
  });

  it("keeps the GPU minute exact where epoch milliseconds would not be, and never early", () => {
    const t = Date.UTC(2026, 5, 1, 12, 0, 30);
    expect(Math.fround(gpuMinute(t, "ceil"))).toBe(gpuMinute(t, "ceil"));
    expect(gpuMinute(t, "ceil")).toBeGreaterThan(gpuMinute(t, "floor"));
    // a flight at 12:00:30 is not drawn by a cursor at 12:00:45 (same minute)
    expect(gpuMinute(t, "ceil")).toBeGreaterThan(gpuMinute(t + 15_000, "floor"));
  });

  it("filters the arc layers by the cursor, and not at all outside live mode", () => {
    const { arcsData, antipodalArcs } = buildGlobeArcData(FLIGHTS, 1, false, 1, undefined, true);
    const layersAt = (liveTime: number | null) =>
      buildGlobeLayers({
        arcsData,
        antipodalArcs,
        headFlightArc: null,
        activeQuartile: null,
        lite: false,
        occlusionExt: {} as never,
        occlusionProps: {} as never,
        onArcHover: () => {},
        setPinned: () => {},
        flightColorConfig: { mode: "frequency" } as never,
        arcWidthScale: 1,
        liveTime,
      });
    const arcs = (liveTime: number | null) =>
      layersAt(liveTime).find((l) => l.id === "globe-flight-arcs")!.props as unknown as {
        filterEnabled: boolean;
        filterRange: [number, number];
        getFilterValue: (d: unknown) => number;
      };
    const live = arcs(day(9));
    expect(live.filterEnabled).toBe(true);
    expect(live.filterRange[1]).toBe(gpuMinute(day(9), "floor"));
    const fra = arcsData.find((a) => a.departure.iata === "FRA")!;
    const muc = arcsData.find((a) => a.departure.iata === "MUC")!;
    expect(live.getFilterValue(fra)).toBeLessThanOrEqual(live.filterRange[1]);
    expect(live.getFilterValue(muc)).toBeGreaterThan(live.filterRange[1]);
    expect(arcs(null).filterEnabled).toBe(false);
  });
});
