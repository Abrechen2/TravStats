import { describe, it, expect } from "vitest";
import { buildFlightPayload } from "./flightPayload";

/**
 * forgejo#256: a historical date known only to the year or month travels with
 * its precision, so the server stores it and no reading ever files the
 * placeholder (the 1st, 00:00) under another day.
 */
const base = {
  departure: { iata: "JFK", lat: 40.64, lon: -73.78, timezone: "America/New_York" },
  arrival: { iata: "LAX", lat: 33.94, lon: -118.41, timezone: "America/Los_Angeles" },
  status: "historical",
  departureTime: "",
  arrivalDate: "",
  arrivalTime: "",
  depTz: "America/New_York",
  arrTz: "America/Los_Angeles",
  tags: [],
  companions: [],
  coPassengers: [],
} as never as Record<string, unknown>;

const payload = (departureDate: string) =>
  buildFlightPayload({ ...base, departureDate } as never) as { datePrecision?: string };

describe("buildFlightPayload — date precision", () => {
  it("marks a year-only date as year", () => {
    expect(payload("2015").datePrecision).toBe("year");
  });
  it("marks a year-and-month date as month", () => {
    expect(payload("2015-03").datePrecision).toBe("month");
  });
  it("sends none for a full date", () => {
    expect(payload("2015-03-14").datePrecision).toBeUndefined();
  });
});
