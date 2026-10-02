import { describe, it, expect } from "@jest/globals";

import { endHasClock, rideEndsAt, rideHasClocks, rideStatusSpan } from "../railClock";
import { isNightTrainRide } from "../railRideKinds";
import { deriveTripStatus, tripStatusBounds } from "../statusDerivation";

/**
 * forgejo#132 item 17: a ride logged date-only is stored at the START of its
 * day(s) on the station's calendar. Nothing that measures between instants
 * may read that midnight as a time.
 */

// The start of 5 and 6 March 2025 in Berlin (UTC+1).
const MAR5 = new Date("2025-03-04T23:00:00.000Z");
const MAR6 = new Date("2025-03-05T23:00:00.000Z");
const MAR7 = new Date("2025-03-06T23:00:00.000Z");

const dayRide = {
  departureTime: MAR5,
  arrivalTime: MAR6,
  depTimezone: "Europe/Berlin",
  arrTimezone: "Europe/Berlin",
  depPrecision: "day",
  arrPrecision: "day",
};

describe("railClock", () => {
  it("reads a NULL precision as a clock (rows written before the column)", () => {
    expect(endHasClock(null)).toBe(true);
    expect(endHasClock("minute")).toBe(true);
    expect(endHasClock("day")).toBe(false);
    expect(endHasClock("unknown")).toBe(false);
    expect(rideHasClocks({ depPrecision: "minute", arrPrecision: "day" })).toBe(false);
  });

  it("ends a dateless ride when its last day is over at the station", () => {
    expect(rideEndsAt(dayRide).toISOString()).toBe(MAR7.toISOString());
    // No arrival: the departure day.
    expect(rideEndsAt({ ...dayRide, arrivalTime: null, arrPrecision: null }).toISOString()).toBe(
      MAR6.toISOString()
    );
    // A clocked end is its own instant.
    const clocked = {
      ...dayRide,
      arrPrecision: "minute",
      arrivalTime: new Date("2025-03-05T11:00:00Z"),
    };
    expect(rideEndsAt(clocked).toISOString()).toBe("2025-03-05T11:00:00.000Z");
  });

  it("finds no night train in a dateless ride that 'arrives' the next day", () => {
    const ride = {
      ...dayRide,
      trainCategory: "ICE",
      travelClass: null,
      depCountry: "DE",
      arrCountry: "DE",
      depDayKey: "2025-03-05",
      arrDayKey: "2025-03-06",
    };
    expect(isNightTrainRide(ride)).toBe(false);
    // The same ride timed 22:00 → 07:00 is one.
    expect(
      isNightTrainRide({
        ...ride,
        departureTime: new Date("2025-03-05T21:00:00Z"),
        arrivalTime: new Date("2025-03-06T06:00:00Z"),
        depPrecision: "minute",
        arrPrecision: "minute",
      })
    ).toBe(true);
    // A sleeper is a night train whatever the clock says: that is not a reading of it.
    expect(isNightTrainRide({ ...ride, travelClass: "sleeper" })).toBe(true);
  });

  it("keeps a trip running through the whole last day of a dateless ride", () => {
    const noonOnThe6th = new Date("2025-03-06T11:00:00Z");
    const bounds = tripStatusBounds({
      flights: [],
      cruises: [],
      railJourneys: [rideStatusSpan(dayRide)],
      ownStartDate: null,
      ownEndDate: null,
      zone: "Europe/Berlin",
    });
    expect(deriveTripStatus({ ...bounds, now: noonOnThe6th })).toBe("in_progress");
    expect(deriveTripStatus({ ...bounds, now: new Date("2025-03-07T00:30:00Z") })).toBe(
      "completed"
    );
  });
});
