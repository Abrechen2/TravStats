import { farthestFromHomeOf } from "../airportStats";
import type { FlightData } from "../types";
import type { HomePeriod } from "../../homeAirport";

/**
 * "Farthest from home" is measured from where the user lived WHEN they flew.
 * A flight with no departure time has no "when"; it was measured from
 * today's home instead — a guess, and after a move a wrong one, presented as
 * a record. An undated flight now takes no part.
 */
const MUNICH_TO_2020: HomePeriod = {
  fromDate: "2010-01-01",
  toDate: "2020-01-01",
  residence: { name: "München", lat: 48.14, lon: 11.58 },
  residenceConfirmed: true,
  airports: [{ code: "MUC", primary: true }],
};
const SYDNEY_NOW: HomePeriod = {
  fromDate: "2020-01-01",
  toDate: null,
  residence: { name: "Sydney", lat: -33.87, lon: 151.21 },
  residenceConfirmed: true,
  airports: [{ code: "SYD", primary: true }],
};

const flight = (over: Partial<FlightData>): FlightData => ({
  id: "f",
  depLat: 48.35,
  depLon: 11.79,
  arrLat: 51.47,
  arrLon: -0.45,
  depIata: "MUC",
  arrIata: "LHR",
  departureTime: new Date("2015-06-01T08:00:00Z"),
  arrivalTime: null,
  status: "flown",
  createdAt: new Date("2015-01-01T00:00:00Z"),
  ...over,
});

describe("farthestFromHomeOf — an undated flight", () => {
  it("is left out rather than measured from today's home", () => {
    const undated = flight({ id: "undated", departureTime: null });
    expect(farthestFromHomeOf([undated], [MUNICH_TO_2020, SYDNEY_NOW])).toBeNull();
  });

  it("does not displace a dated flight's record", () => {
    const dated = flight({ id: "dated" });
    const undated = flight({ id: "undated", departureTime: null });
    expect(farthestFromHomeOf([dated, undated], [MUNICH_TO_2020, SYDNEY_NOW])?.flightId).toBe(
      "dated"
    );
  });
});
