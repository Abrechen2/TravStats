import { describe, it, expect } from "@jest/globals";
import { createFlightSchema, updateFlightSchema } from "../flight";

/**
 * SRV-TIMEZONE-GAP-001 (audit 2026-09-20): MUC→CDG with
 * `departureLocal=2025-03-30T02:30` and Europe/Berlin was saved with a 201
 * and stored as 00:30Z. The detail page then showed 01:30 — the entered hour
 * does not exist in Berlin that day, and nothing said so.
 */

const baseAirport = { lat: 48.35, lon: 11.79, iata: "MUC" };
const gapFlight = {
  departure: baseAirport,
  arrival: { lat: 49.01, lon: 2.55, iata: "CDG" },
  status: "scheduled" as const,
  departureLocal: "2025-03-30T02:30",
  depTimezone: "Europe/Berlin",
  arrivalLocal: "2025-03-30T05:00",
  arrTimezone: "Europe/Paris",
};

describe("flight schemas — a local time that does not exist", () => {
  it("refuses the skipped spring-forward hour on create", () => {
    expect(() => createFlightSchema.parse(gapFlight)).toThrow(/does not exist in Europe\/Berlin/);
  });

  it("refuses it on update too", () => {
    expect(() =>
      updateFlightSchema.parse({
        departureLocal: "2025-03-30T02:30",
        depTimezone: "Europe/Berlin",
      })
    ).toThrow(/does not exist in Europe\/Berlin/);
  });

  it("accepts the hour either side of the gap", () => {
    expect(() =>
      createFlightSchema.parse({ ...gapFlight, departureLocal: "2025-03-30T01:30" })
    ).not.toThrow();
    expect(() =>
      createFlightSchema.parse({ ...gapFlight, departureLocal: "2025-03-30T03:30" })
    ).not.toThrow();
  });

  it("accepts the autumn repeated hour — ambiguous is not impossible", () => {
    expect(() =>
      createFlightSchema.parse({
        ...gapFlight,
        departureLocal: "2025-10-26T02:30",
        arrivalLocal: "2025-10-26T05:00",
      })
    ).not.toThrow();
  });

  it("checks the ACTUAL times as well, not only the scheduled ones", () => {
    expect(() =>
      createFlightSchema.parse({
        ...gapFlight,
        departureLocal: "2025-03-30T01:30",
        actualDepartureLocal: "2025-03-30T02:30",
        actualDepartureTz: "Europe/Berlin",
      })
    ).toThrow(/does not exist in Europe\/Berlin/);
  });

  // A DATE_ONLY row's clock is a placeholder the importer chose, and a few
  // zones move their clocks AT midnight — so the rule would refuse a bulk
  // import of a Havana departure for a reason the user cannot act on.
  it("exempts a DATE_ONLY row, whose clock component means nothing", () => {
    expect(() =>
      createFlightSchema.parse({
        ...gapFlight,
        status: "historical" as const,
        departureLocal: "2025-03-09T00:30",
        depTimezone: "America/Havana",
        depTimeSemantics: "DATE_ONLY" as const,
        arrivalLocal: "2025-03-09T06:00",
        arrTimeSemantics: "DATE_ONLY" as const,
      })
    ).not.toThrow();
  });
});
