import { calculateAirportStats } from "../airportStats";
import type { FlightData } from "../types";

jest.mock("../../../services/airportCache", () => ({
  getCachedAirports: jest.fn(async () => new Map()),
}));

/**
 * forgejo#256 — the "visited only once" list showed the first five airports
 * in database read order. Every one of them ties at one visit, so the cut is
 * a stated rule now: the most recently first visited first, then by code,
 * with the number that tie beside it.
 */
const leg = (dep: string, arr: string, day: string): FlightData => ({
  id: `${dep}-${arr}-${day}`,
  status: "flown",
  depIata: dep,
  arrIata: arr,
  depLat: 0,
  depLon: 0,
  arrLat: 0,
  arrLon: 1,
  departureTime: new Date(`${day}T10:00:00Z`),
  arrivalTime: new Date(`${day}T12:00:00Z`),
  createdAt: new Date(),
});

describe("calculateAirportStats — rarest airports", () => {
  it("lists the most recently first visited of the single-visit airports, and says how many tie", async () => {
    // FRA is the hub (visited every time); the other ends are visited once each.
    const flights = [
      leg("FRA", "AAA", "2020-01-01"),
      leg("FRA", "BBB", "2024-05-01"),
      leg("FRA", "CCC", "2021-01-01"),
      leg("FRA", "DDD", "2023-01-01"),
      leg("FRA", "EEE", "2022-01-01"),
      leg("FRA", "FFF", "2025-01-01"),
      leg("FRA", "GGG", "2025-01-01"),
    ];
    const stats = await calculateAirportStats(flights);
    expect(stats.rarestAirports.map((a) => a.code)).toEqual(["FFF", "GGG", "BBB", "DDD", "EEE"]);
    expect(stats.rarestAirportsTotal).toBe(7);
  });
});

describe("calculateAirportStats — new this year (forgejo#256)", () => {
  it("files the list under the year of the caller's today, and says which", async () => {
    const flights = [leg("FRA", "AAA", "2026-01-01"), leg("FRA", "BBB", "2025-12-31")];
    // 1 January 2026 in Auckland is still 31 December 2025 in UTC — the
    // profile zone's today decides, not the server's clock.
    const stats = await calculateAirportStats(flights, [], "2026-01-01");
    expect(stats.newThisYearYear).toBe(2026);
    expect(stats.newThisYear.map((a) => a.code)).toEqual(["AAA"]);
    const before = await calculateAirportStats(flights, [], "2025-12-31");
    expect(before.newThisYearYear).toBe(2025);
    expect(before.newThisYear.map((a) => a.code).sort()).toEqual(["BBB", "FRA"]);
  });
});
