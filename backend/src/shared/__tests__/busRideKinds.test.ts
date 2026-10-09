import { describe, it, expect } from "@jest/globals";

import {
  isNightBusRide,
  nightBusNights,
  sameTerminal,
  terminalsOf,
  busConnectionKey,
} from "../busRideKinds";

/** forgejo#263 — night buses by the clock, and terminals with a stable identity. */
const ride = (dep: string, arr: string | null, over: Record<string, unknown> = {}) => ({
  departureTime: new Date(dep),
  arrivalTime: arr ? new Date(arr) : null,
  depTimezone: "Europe/Berlin",
  arrTimezone: "Europe/Berlin",
  depPrecision: "minute",
  arrPrecision: "minute",
  ...over,
});

describe("night buses", () => {
  it("is overnight by the terminals' clocks after at least six hours", () => {
    const nightly = ride("2025-03-01T21:30:00Z", "2025-03-02T06:00:00Z");
    expect(isNightBusRide(nightly)).toBe(true);
    expect(nightBusNights(nightly)).toEqual(["2025-03-01"]);
  });

  it("does not call a short hop across midnight a night", () => {
    expect(isNightBusRide(ride("2025-03-01T22:30:00Z", "2025-03-01T23:30:00Z"))).toBe(false);
  });

  it("never invents a night from a date-only ride or a missing arrival", () => {
    const dateOnly = ride("2025-03-01T00:00:00Z", "2025-03-02T00:00:00Z", {
      depPrecision: "day",
      arrPrecision: "day",
    });
    expect(isNightBusRide(dateOnly)).toBe(false);
    expect(nightBusNights(ride("2025-03-01T21:00:00Z", null))).toEqual([]);
  });
});

describe("terminal identity", () => {
  const hamburg = { name: "ZOB", lat: 53.5527, lon: 10.0102 };
  const berlin = { name: "ZOB", lat: 52.5073, lon: 13.2797 };

  it("keeps two terminals of one name in different cities apart", () => {
    expect(sameTerminal(hamburg, berlin)).toBe(false);
  });

  it("joins two pins of one terminal, by distance or by name nearby", () => {
    expect(sameTerminal(hamburg, { name: "Hamburg Busbahnhof", lat: 53.5531, lon: 10.011 })).toBe(
      true
    );
    expect(sameTerminal(hamburg, { name: "zob ", lat: 53.58, lon: 10.05 })).toBe(true);
  });

  it("gives the same rides the same terminals, and one connection for both directions", () => {
    const rides = [
      {
        id: "b",
        depStationName: "ZOB",
        depLat: berlin.lat,
        depLon: berlin.lon,
        arrStationName: "ZOB",
        arrLat: hamburg.lat,
        arrLon: hamburg.lon,
        departureTime: new Date("2025-05-02T08:00:00Z"),
      },
      {
        id: "a",
        depStationName: "ZOB",
        depLat: hamburg.lat,
        depLon: hamburg.lon,
        arrStationName: "ZOB",
        arrLat: berlin.lat,
        arrLon: berlin.lon,
        departureTime: new Date("2025-05-01T08:00:00Z"),
      },
    ];
    const { registry, ends } = terminalsOf(rides);
    expect(registry.size).toBe(2);
    expect(busConnectionKey(ends.get("a")!)).toBe(busConnectionKey(ends.get("b")!));
  });
});
