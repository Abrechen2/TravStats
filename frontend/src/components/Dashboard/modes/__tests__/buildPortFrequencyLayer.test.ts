import { describe, it, expect } from "vitest";
import { computePortFrequency } from "../buildPortFrequencyLayer";
import type { Cruise } from "../../../../types/cruise";

function cruise(id: string, portIds: number[]): Cruise {
  return {
    id,
    stops: portIds.map((pid, idx) => ({
      id: `${id}-${idx}`,
      cruiseId: id,
      portId: pid,
      port: {
        id: pid,
        name: `Port ${pid}`,
        lat: pid,
        lon: pid,
        city: null,
        country: null,
        unlocode: null,
        timezone: null,
        region: null,
        isUserAdded: false,
      },
      dayNumber: idx + 1,
      isAtSea: false,
      arrivalTime: null,
      departureTime: null,
      excursionNote: null,
    })),
  } as unknown as Cruise;
}

describe("computePortFrequency", () => {
  it("counts visits per port across all cruises", () => {
    const cruises = [cruise("a", [1, 2, 3]), cruise("b", [2, 3, 3])];
    const freq = computePortFrequency(cruises);
    const byId = Object.fromEntries(freq.map((p) => [p.portId, p.count]));
    expect(byId[1]).toBe(1);
    expect(byId[2]).toBe(2);
    expect(byId[3]).toBe(3);
  });

  it("ignores sea-days and stops without a port", () => {
    const c = cruise("x", [1]);
    c.stops.push({
      id: "x-sea",
      cruiseId: "x",
      portId: null,
      port: null,
      dayNumber: 2,
      date: null,
      isAtSea: true,
      arrivalTime: null,
      departureTime: null,
      excursionNote: null,
    });
    const freq = computePortFrequency([c]);
    expect(freq.length).toBe(1);
    expect(freq[0].portId).toBe(1);
  });

  it("returns an empty array for no cruises", () => {
    expect(computePortFrequency([])).toEqual([]);
  });

  it("returns an empty array when all stops are sea days", () => {
    const c = cruise("y", []);
    c.stops.push({
      id: "y-sea",
      cruiseId: "y",
      portId: null,
      port: null,
      dayNumber: 1,
      date: null,
      isAtSea: true,
      arrivalTime: null,
      departureTime: null,
      excursionNote: null,
    });
    expect(computePortFrequency([c])).toEqual([]);
  });
});
