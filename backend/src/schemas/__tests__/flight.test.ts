/**
 * Schema tests for the canonical-UTC submit contract.
 *
 * Asserts that:
 *  - The new {departureLocal, depTimezone} pair is required for non-historical
 *    flights and rejects half-pairs (local without tz, etc).
 *  - The legacy `departureTime` ISO field is no longer accepted.
 *  - IANA timezone strings are validated.
 */
import { describe, it, expect } from "@jest/globals";
import { createFlightSchema, updateFlightSchema } from "../flight";

const baseAirport = { lat: 50, lon: 8, iata: "FRA" };
const baseValid = {
  departure: baseAirport,
  arrival: { ...baseAirport, lat: 52, lon: 13, iata: "BER" },
  status: "scheduled" as const,
  departureLocal: "2026-05-01T10:30",
  depTimezone: "Europe/Berlin",
  arrivalLocal: "2026-05-01T11:30",
  arrTimezone: "Europe/Berlin",
};

describe("createFlightSchema — canonical-UTC contract", () => {
  it("accepts a valid local + IANA tz pair", () => {
    expect(() => createFlightSchema.parse(baseValid)).not.toThrow();
  });

  it("rejects departureLocal without depTimezone", () => {
    const { depTimezone: _omit, ...rest } = baseValid;
    expect(() => createFlightSchema.parse(rest)).toThrow(/depTimezone is required/);
  });

  it("rejects an invalid IANA timezone", () => {
    expect(() =>
      createFlightSchema.parse({ ...baseValid, depTimezone: "Berlin/Invalid" }),
    ).toThrow(/Invalid IANA timezone/);
  });

  it("rejects a malformed local datetime string", () => {
    expect(() =>
      createFlightSchema.parse({ ...baseValid, departureLocal: "01.05.2026 10:30" }),
    ).toThrow(/Expected YYYY-MM-DDTHH:mm/);
  });

  it("rejects the legacy departureTime ISO field as unknown", () => {
    // Zod's default behavior strips unknown keys, so the legacy field is
    // simply ignored — but then no canonical pair is present and the
    // chronological-order refinement fails.
    const legacy = {
      departure: baseAirport,
      arrival: { ...baseAirport, lat: 52, lon: 13, iata: "BER" },
      status: "scheduled" as const,
      departureTime: "2026-05-01T10:30:00.000Z",
      arrivalTime: "2026-05-01T11:30:00.000Z",
    };
    expect(() => createFlightSchema.parse(legacy)).toThrow();
  });

  it("allows historical flights without time fields", () => {
    expect(() =>
      createFlightSchema.parse({
        departure: baseAirport,
        arrival: { ...baseAirport, lat: 52, lon: 13, iata: "BER" },
        status: "historical",
      }),
    ).not.toThrow();
  });
});

describe("updateFlightSchema — partial canonical-UTC contract", () => {
  it("accepts a partial update with just one local+tz pair", () => {
    expect(() =>
      updateFlightSchema.parse({
        departureLocal: "2026-05-01T11:00",
        depTimezone: "Europe/Berlin",
      }),
    ).not.toThrow();
  });

  it("rejects a partial update missing the tz half", () => {
    expect(() =>
      updateFlightSchema.parse({ departureLocal: "2026-05-01T11:00" }),
    ).toThrow(/depTimezone is required/);
  });

  it("rejects empty updates", () => {
    expect(() => updateFlightSchema.parse({})).toThrow(/At least one field/);
  });
});
