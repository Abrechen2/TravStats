import { describe, it, expect } from "vitest";

import { tripEntrySpan, type TripWithEntries } from "../tripEntrySpan";

type Flight = NonNullable<TripWithEntries["flights"]>[number];
type Cruise = NonNullable<TripWithEntries["cruises"]>[number];
type Stay = NonNullable<TripWithEntries["lodgingStays"]>[number];

const flight = (over: Partial<Flight>): Flight =>
  ({
    id: "f",
    status: "flown",
    depTimeSemantics: "UTC",
    arrTimeSemantics: "UTC",
    ...over,
  }) as Flight;
const cruise = (over: Partial<Cruise>): Cruise =>
  ({ id: "c", cruiseLine: null, shipId: null, status: "completed", ...over }) as Cruise;
const stay = (over: Partial<Stay>): Stay => ({ id: "s", status: "completed", ...over }) as Stay;

describe("tripEntrySpan", () => {
  it("abstains for a trip without dated entries", () => {
    expect(tripEntrySpan({})).toBeNull();
    expect(tripEntrySpan({ flights: [flight({ departureTime: null })] })).toBeNull();
  });

  it("spans the earliest start to the latest end across flights, cruises and stays", () => {
    expect(
      tripEntrySpan({
        flights: [
          flight({ departureTime: "2025-05-02T08:00:00Z", arrivalTime: "2025-05-02T11:00:00Z" }),
        ],
        cruises: [cruise({ startDate: "2025-05-03T00:00:00Z", endDate: "2025-05-10T00:00:00Z" })],
        lodgingStays: [stay({ checkIn: "2025-05-01T00:00:00Z", checkOut: "2025-05-03T00:00:00Z" })],
      })
    ).toEqual({ start: "2025-05-01", end: "2025-05-10" });
  });

  it("reads a flight's day on the clock at its own airport, not in UTC", () => {
    // 23:30 in New York is 03:30 UTC the next day; the trip starts that evening.
    expect(
      tripEntrySpan({
        flights: [
          flight({
            departureTime: "2025-05-02T03:30:00Z",
            depTimezone: "America/New_York",
            arrivalTime: "2025-05-02T15:00:00Z",
            arrTimezone: "Europe/Berlin",
          }),
        ],
      })
    ).toEqual({ start: "2025-05-01", end: "2025-05-02" });
  });

  it("lets a one-ended entry count as a single day, and ignores cancelled ones", () => {
    expect(
      tripEntrySpan({
        cruises: [cruise({ startDate: "2025-06-05T00:00:00Z", endDate: null })],
        lodgingStays: [
          stay({ checkIn: null, checkOut: "2025-06-04T00:00:00Z" }),
          stay({
            checkIn: "2025-07-01T00:00:00Z",
            checkOut: "2025-07-09T00:00:00Z",
            status: "cancelled",
          }),
        ],
        flights: [flight({ departureTime: "2025-01-01T08:00:00Z", status: "cancelled" })],
      })
    ).toEqual({ start: "2025-06-04", end: "2025-06-05" });
  });
});
