/**
 * forgejo#273 — a change of planes at the home airport is left out on the day
 * the traveller ARRIVED there, read on that airport's clock. The check cut the
 * day at UTC midnight, so on the first or last day of a home period an arrival
 * on the far side of UTC midnight was judged against the wrong home.
 */
import { calculateUniqueStats } from "../utils/statsCalculator";
import type { FlightData } from "../utils/statsCalculator";
import { periodsFromLegacy, type HomeAirportEntry } from "../utils/homeAirport";

jest.mock("../services/airportCache", () => ({
  getCachedAirports: jest.fn(
    async () =>
      new Map([
        ["NRT", { timezone: "Asia/Tokyo" }],
        ["JFK", { timezone: "America/New_York" }],
        ["MUC", { timezone: "Europe/Berlin" }],
      ])
  ),
}));

const periods = (history: HomeAirportEntry[]) => periodsFromLegacy(history, () => null);

function flight(dep: string, arr: string, departure: string, arrival: string): FlightData {
  return {
    id: `f-${dep}-${arr}-${departure}`,
    depIata: dep,
    arrIata: arr,
    depIcao: null,
    arrIcao: null,
    depLat: 0,
    depLon: 0,
    arrLat: 0,
    arrLon: 0,
    departureTime: new Date(departure),
    arrivalTime: new Date(arrival),
    status: "flown",
    createdAt: new Date(),
  };
}

describe("calculateUniqueStats — home-airport layover on the arrival airport's day", () => {
  it("Tokyo, east of UTC: an arrival at 07:30 local belongs to that local day", () => {
    // NRT became home on 2 September. The landing at 07:30 JST on the 2nd is
    // 22:30Z on the 1st — the UTC day said "not home yet" and kept a 3 h layover.
    const flights = [
      flight("MUC", "NRT", "2026-09-01T09:00:00Z", "2026-09-01T22:30:00Z"),
      flight("NRT", "MUC", "2026-09-02T01:30:00Z", "2026-09-02T14:00:00Z"),
    ];
    const home = periods([{ iata: "NRT", fromDate: "2026-09-02", toDate: null }]);
    return calculateUniqueStats(flights, home).then((result) => {
      expect(result.longestLayover).toBeNull();
    });
  });

  it("New York, west of UTC: a late-evening arrival is still the local day", () => {
    // JFK was home until 2 September (exclusive). The landing at 22:00 EDT on
    // 1 September is 02:00Z on the 2nd — the UTC day said "home is over".
    const flights = [
      flight("MUC", "JFK", "2026-09-01T18:00:00Z", "2026-09-02T02:00:00Z"),
      flight("JFK", "MUC", "2026-09-02T05:00:00Z", "2026-09-02T13:00:00Z"),
    ];
    const home = periods([{ iata: "JFK", fromDate: "2020-01-01", toDate: "2026-09-02" }]);
    return calculateUniqueStats(flights, home).then((result) => {
      expect(result.longestLayover).toBeNull();
    });
  });

  it("keeps the layover when the local day is outside the home period", () => {
    // The same Tokyo landing, with NRT home only from the 3rd: a real change
    // of planes, three hours long.
    const flights = [
      flight("MUC", "NRT", "2026-09-01T09:00:00Z", "2026-09-01T22:30:00Z"),
      flight("NRT", "MUC", "2026-09-02T01:30:00Z", "2026-09-02T14:00:00Z"),
    ];
    const home = periods([{ iata: "NRT", fromDate: "2026-09-03", toDate: null }]);
    return calculateUniqueStats(flights, home).then((result) => {
      expect(result.longestLayover).toEqual({ hours: 3, from: "NRT", to: "NRT" });
    });
  });
});
