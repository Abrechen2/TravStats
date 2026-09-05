import { describe, expect, it } from "vitest";
import { flightDurationOf, measureFlightMinutes } from "../flightDuration";

// Mirror of backend/src/shared/__tests__/flightDuration.measure.test.ts — the
// same rows, the same numbers. FRA → JFK is ~6200 km, so the estimate is ~480
// minutes, deliberately unlike the placeholder clocks.
const FRA_JFK = { depLat: 50.0379, depLon: 8.5622, arrLat: 40.6398, arrLon: -73.7789 };

describe("measureFlightMinutes — the clocks are evidence only under UTC semantics", () => {
  it("measures a UTC row", () => {
    expect(
      measureFlightMinutes({
        ...FRA_JFK,
        departureTime: "2024-05-01T10:00:00Z",
        arrivalTime: "2024-05-01T18:30:00Z",
        depTimeSemantics: "UTC",
      })
    ).toBe(510);
  });

  it("treats a row without the column as UTC", () => {
    expect(
      measureFlightMinutes({
        ...FRA_JFK,
        departureTime: "2024-05-01T10:00:00Z",
        arrivalTime: "2024-05-01T11:00:00Z",
      })
    ).toBe(60);
  });

  it.each(["DATE_ONLY", "UNKNOWN", "LEGACY_FAKE_UTC"])(
    "returns null for %s semantics, whatever the placeholder clocks say",
    (semantics) => {
      expect(
        measureFlightMinutes({
          ...FRA_JFK,
          departureTime: "1989-03-15T12:00:00Z",
          arrivalTime: "1989-03-15T13:00:00Z",
          depTimeSemantics: semantics,
        })
      ).toBeNull();
    }
  );

  it("returns null for a missing clock and for a non-positive difference", () => {
    expect(
      measureFlightMinutes({ ...FRA_JFK, departureTime: "2024-05-01T12:00:00Z", arrivalTime: null })
    ).toBeNull();
    expect(
      measureFlightMinutes({
        ...FRA_JFK,
        departureTime: "2024-05-01T12:00:00Z",
        arrivalTime: "2024-05-01T12:00:00Z",
      })
    ).toBeNull();
  });
});

describe("flightDurationOf — measure when allowed, else estimate, else nothing", () => {
  it("estimates a DATE_ONLY row from its coordinates and says so", () => {
    const result = flightDurationOf({
      ...FRA_JFK,
      departureTime: "1989-03-15T12:00:00Z",
      arrivalTime: "1989-03-15T13:00:00Z",
      depTimeSemantics: "DATE_ONLY",
    });
    expect(result?.estimated).toBe(true);
    expect(result?.minutes).toBeGreaterThan(400);
    expect(result?.minutes).toBeLessThan(560);
  });

  it("measures a UTC row and marks it as measured", () => {
    expect(
      flightDurationOf({
        ...FRA_JFK,
        departureTime: "2024-05-01T10:00:00Z",
        arrivalTime: "2024-05-01T18:00:00Z",
        depTimeSemantics: "UTC",
      })
    ).toEqual({ minutes: 480, estimated: false });
  });

  it("answers null, never 0, with neither clocks nor coordinates", () => {
    expect(
      flightDurationOf({
        departureTime: null,
        arrivalTime: null,
        depLat: null,
        depLon: null,
        arrLat: null,
        arrLon: null,
      })
    ).toBeNull();
  });
});
