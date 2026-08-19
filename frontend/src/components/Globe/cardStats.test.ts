import { describe, it, expect } from "vitest";
import { getAirportStats, getPortStats } from "./cardStats";
import type { Cruise, Port } from "../../types/cruise";
import type { GeoJSONFeature } from "../../types";

const PORT: Port = {
  id: 1,
  name: "Civitavecchia",
  city: "Civitavecchia",
  country: "IT",
  unlocode: "ITCVV",
  lat: 41.9,
  lon: 12.45,
  timezone: null,
  region: null,
  isUserAdded: false,
};

function makeFlight(
  departureIata: string,
  arrivalIata: string,
  departureTime: string | null,
  status: string,
  distance: number = 1000,
  airline: string = "LH",
  _aircraft: string = "A350"
): GeoJSONFeature {
  return {
    type: "Feature",
    properties: {
      id: `flight-${Math.random()}`,
      airline,
      flightNumber: "123",
      departureAirport: {
        iata: departureIata,
        lat: 0,
        lon: 0,
      },
      arrivalAirport: {
        iata: arrivalIata,
        lat: 10,
        lon: 10,
      },
      departureTime,
      arrivalTime: null,
      status,
      distance,
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [10, 10],
      ],
    },
  };
}

function makeStop(
  arrivalTime: string | null,
  departureTime: string | null
): Cruise["stops"][number] {
  return {
    id: "s1",
    cruiseId: "c1",
    portId: PORT.id,
    port: PORT,
    dayNumber: 1,
    date: null,
    isAtSea: false,
    arrivalTime,
    departureTime,
    excursionNote: null,
    unresolvedPortName: null,
  };
}

function makeCruise(id: string, status: Cruise["status"], stops: Cruise["stops"]): Cruise {
  return {
    id,
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "AIDA Cruises",
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: null,
    endDate: null,
    status,
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops,
    createdAt: "",
    updatedAt: "",
  };
}

describe("getPortStats", () => {
  it("ignores scheduled cruises: totalVisits comes from flown only, lastCallDate is not in the future", () => {
    const flownArrival = "2024-05-10T09:00:00.000Z";
    const flownCruise = makeCruise("flown", "flown", [
      makeStop(flownArrival, "2024-05-10T18:00:00.000Z"),
    ]);
    // A future, still-scheduled cruise calling at the same port — must not
    // contribute a visit or push lastCallDate into the future.
    const futureArrival = "2099-01-01T09:00:00.000Z";
    const scheduledCruise = makeCruise("scheduled", "scheduled", [
      makeStop(futureArrival, "2099-01-01T18:00:00.000Z"),
    ]);

    const stats = getPortStats([flownCruise, scheduledCruise], "Civitavecchia");

    expect(stats.totalVisits).toBe(1);
    expect(stats.lastCallDate).toBe(flownArrival);
  });

  it("counts historical cruises as sailed", () => {
    const arrival = "2019-03-01T09:00:00.000Z";
    const historicalCruise = makeCruise("historical", "historical", [
      makeStop(arrival, "2019-03-01T18:00:00.000Z"),
    ]);

    const stats = getPortStats([historicalCruise], "Civitavecchia");

    expect(stats.totalVisits).toBe(1);
    expect(stats.lastCallDate).toBe(arrival);
  });
});

describe("getAirportStats", () => {
  it("excludes scheduled flights from visit count and last visit date", () => {
    // A flown flight in the past, departing from FRA, with 1000 km distance.
    const flownDeparture = "2024-05-10T09:00:00.000Z";
    const flownFlight = makeFlight("FRA", "LHR", flownDeparture, "flown", 1000, "LH", "A350");

    // A scheduled flight in the future, also departing from FRA, with longer distance (2000 km).
    // This must not count as a visit or push lastVisitDate into the future.
    const scheduledDeparture = "2099-01-01T09:00:00.000Z";
    const scheduledFlight = makeFlight(
      "FRA",
      "JFK",
      scheduledDeparture,
      "scheduled",
      2000,
      "LH",
      "A380"
    );

    const stats = getAirportStats([flownFlight, scheduledFlight], "FRA");

    // Only the flown flight counts as a visit.
    expect(stats.totalVisits).toBe(1);
    // Last visit date is from the flown flight, not the future scheduled one.
    expect(stats.lastVisitDate).toBe(flownDeparture);
    // But longestRoute may still come from any touched flight (including scheduled),
    // since route statistics are neutral favourites computed over all flights.
    expect(stats.longestRoute?.iata).toBe("JFK");
    expect(stats.longestRoute?.km).toBe(2000);
  });
});
