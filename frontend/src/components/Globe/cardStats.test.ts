import { describe, it, expect } from "vitest";
import { getPortStats } from "./cardStats";
import type { Cruise, Port } from "../../types/cruise";

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
