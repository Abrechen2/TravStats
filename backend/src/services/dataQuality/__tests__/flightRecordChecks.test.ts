import { describe, expect, it } from "@jest/globals";

import { dataQualityFlagPayloadSchema } from "../../../schemas/dataQualityFlag";
import { findUnknownAirports } from "../checks/airportUnknown";
import { findMissingFlightNumbers } from "../checks/flightNumberMissing";
import { flight, snapshot } from "./recordFixtures";

describe("findMissingFlightNumbers — a named carrier and no number", () => {
  it("asks about a scheduled or flown airline flight with no number", () => {
    const findings = findMissingFlightNumbers([
      flight({ id: "flown", flightNumber: null }),
      flight({ id: "booked", flightNumber: null, status: "scheduled" }),
    ]);
    expect(findings.map((f) => f.entityId)).toEqual(["flown", "booked"]);
    expect(findings[0]).toMatchObject({
      entityType: "flight",
      kind: "flight_number_missing",
      details: { airline: "Lufthansa", status: "flown" },
    });
    expect(dataQualityFlagPayloadSchema.safeParse(findings[0]).success).toBe(true);
  });

  it("does NOT ask about a private, special, cargo, historical or cancelled flight", () => {
    const findings = findMissingFlightNumbers([
      flight({ id: "private", flightNumber: null, airline: null }),
      flight({ id: "sightseeing", flightNumber: null, specialType: "sightseeing" }),
      flight({ id: "cargo", flightNumber: null, isCargo: true }),
      flight({ id: "memory", flightNumber: null, status: "historical" }),
      flight({ id: "cancelled", flightNumber: null, status: "cancelled" }),
      flight({ id: "numbered" }),
    ]);
    expect(findings).toEqual([]);
  });
});

describe("findUnknownAirports — a code the catalogue does not know", () => {
  it("asks about the end whose codes all fail, and names it", () => {
    const findings = findUnknownAirports(
      snapshot({
        flights: [flight({ id: "typo", arr: { iata: "JFX", icao: null, name: "New York" } })],
      })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      entityType: "flight",
      entityId: "typo",
      kind: "airport_unknown",
      details: { endpoints: [{ side: "arrival", iata: "JFX", icao: null, name: "New York" }] },
    });
    expect(dataQualityFlagPayloadSchema.safeParse(findings[0]).success).toBe(true);
  });

  it("does NOT ask when one code resolves, when no code is written, or case differs", () => {
    const findings = findUnknownAirports(
      snapshot({
        flights: [
          flight({ id: "icaoOk", dep: { iata: "XXX", icao: "EDDF", name: null } }),
          flight({ id: "noCode", dep: { iata: null, icao: null, name: "Grass strip" } }),
          flight({ id: "lower", dep: { iata: "fra", icao: null, name: null } }),
        ],
      })
    );
    expect(findings).toEqual([]);
  });

  it("abstains entirely while the catalogue is empty", () => {
    const findings = findUnknownAirports(
      snapshot({
        airportCatalogueEmpty: true,
        knownAirportCodes: new Set(),
        flights: [flight({ id: "a" })],
      })
    );
    expect(findings).toEqual([]);
  });
});
