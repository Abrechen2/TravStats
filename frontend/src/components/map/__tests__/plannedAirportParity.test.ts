// Owner report, rc.43: a planned-only airport said "2 Flüge" on hover and
// "0 Flüge" in the pinned card, with no hint that it was only planned.
import { describe, expect, it } from "vitest";
import { buildRouteData, airportPlannedOnly } from "../../layers/routesLayer";
import { buildAirportPoints as buildGlobeAirportPoints } from "../../Globe/globePointData";
import { getAirportStats } from "../cards/cardStats";
import { airportHoverHtml, plannedSummaryText } from "../cards/hoverCardHtml";
import type { GeoJSONFeature } from "../../../types";

function flight(id: string, status: string, from = "FRA", to = "MUC"): GeoJSONFeature {
  const at: Record<string, [number, number]> = { FRA: [8.57, 50.03], MUC: [11.79, 48.35] };
  return {
    type: "Feature",
    properties: {
      id,
      status,
      departureAirport: { iata: from, name: from },
      arrivalAirport: { iata: to, name: to },
      departureTime: "2030-05-01T08:00:00Z",
      distance: 300,
    },
    geometry: { type: "LineString", coordinates: [at[from], at[to]] },
  } as unknown as GeoJSONFeature;
}

// Echoes the key and the count, so the assertions read what the user would.
const t = (key: string, o?: Record<string, unknown>) =>
  o && "count" in o ? `${key}:${o.count}` : key;

describe("planned-only airport", () => {
  const flights = [flight("a", "scheduled"), flight("b", "scheduled", "MUC", "FRA")];

  it("hover and pinned card count the same, flown and planned apart", () => {
    const point = buildRouteData(flights, 1).points.find((p) => p.iata === "FRA")!;
    const stats = getAirportStats(flights, "FRA");
    expect(point.flownCount).toBe(stats.totalVisits);
    expect(point.plannedCount).toBe(stats.plannedFlights);
    expect([stats.totalVisits, stats.plannedFlights]).toEqual([0, 2]);
    expect(airportPlannedOnly(point)).toBe(true);
    const html = airportHoverHtml(
      { iata: "FRA", count: point.count, flown: point.flownCount, planned: point.plannedCount },
      { t }
    );
    expect(html).toContain(plannedSummaryText({ visited: 0, planned: 2 }, t));
    expect(html).toContain("map:tooltip.plannedOnly");
  });

  it("does not change when the card is opened and closed (same flights, same answer)", () => {
    const before = buildRouteData(flights, 1).points.find((p) => p.iata === "FRA")!;
    getAirportStats(flights, "FRA");
    const after = buildRouteData(flights, 1).points.find((p) => p.iata === "FRA")!;
    expect(after).toEqual(before);
  });

  it("the globe's airport dot agrees with the flat map's", () => {
    const g = buildGlobeAirportPoints(flights).find((p) => p.iata === "FRA")!;
    expect([g.flownCount, g.plannedCount]).toEqual([0, 2]);
  });

  it("a mixed airport shows both counts and is not planned-only", () => {
    const mixed = [flight("a", "flown"), flight("b", "scheduled")];
    const point = buildRouteData(mixed, 1).points.find((p) => p.iata === "FRA")!;
    expect([point.flownCount, point.plannedCount]).toEqual([1, 1]);
    expect(airportPlannedOnly(point)).toBe(false);
    expect(getAirportStats(mixed, "FRA")).toMatchObject({ totalVisits: 1, plannedFlights: 1 });
  });

  it("a marker without plans reads as before (no planned line)", () => {
    const html = airportHoverHtml({ iata: "FRA", count: 3, flown: 3, planned: 0 }, { t });
    expect(html).toContain("3 map:globe.flight:3");
    expect(html).not.toContain("plannedOnly");
  });
});

describe("cancelled flights are not on the map (flights)", () => {
  const flights = [flight("a", "cancelled"), flight("b", "flown", "MUC", "FRA")];
  it("draw no arc and no count, flat and globe, and are not in the card's count", () => {
    const data = buildRouteData([flight("a", "cancelled")], 1);
    expect(data.arcs).toHaveLength(0);
    expect(data.points).toHaveLength(0);
    expect(buildGlobeAirportPoints([flight("a", "cancelled")])).toHaveLength(0);
    const fra = buildRouteData(flights, 1).points.find((p) => p.iata === "FRA")!;
    expect(fra.count).toBe(1);
    expect(getAirportStats(flights, "FRA").totalVisits).toBe(1);
  });
});
