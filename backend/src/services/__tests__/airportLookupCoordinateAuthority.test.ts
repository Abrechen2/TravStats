import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();

jest.mock("../../db", () => ({
  prisma: {
    airport: { findMany: mockFindMany, findFirst: mockFindFirst, create: mockCreate },
  },
}));

import { enrichFlightAirports } from "../airportLookup";
import { clearAirportCache } from "../airportCache";

/**
 * The write side of the same defect the map exposed.
 *
 * `enrichFlightAirports` used to read
 *   lat: flightData.departure.lat ?? foundDeparture.lat
 * which makes the catalogue a mere gap-filler: any caller that brings its own
 * coordinate wins, and every import path brings one. Different sources quote
 * different reference points for the same airport (terminal, ARP, runway
 * threshold), so the stored copies drift apart and never converge.
 *
 * The catalogue is the single source of truth for WHERE an airport is. A
 * caller may still contribute a coordinate — but only for an airport the
 * catalogue does not know.
 */
const zurichCatalogue = {
  iata: "ZRH",
  icao: "LSZH",
  name: "Zürich Airport",
  city: "Zurich",
  country: "CH",
  lat: 47.458056,
  lon: 8.548056,
  altitude: 1416,
  timezone: "Europe/Zurich",
  isClosed: false,
};

describe("enrichFlightAirports — coordinate authority", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAirportCache();
    mockFindMany.mockResolvedValue([zurichCatalogue]);
  });

  it("overrides a caller coordinate that disagrees with the catalogue", async () => {
    const enriched = await enrichFlightAirports({
      departure: { iata: "ZRH", lat: 47.4647, lon: 8.5492 },
      arrival: { iata: "ZRH", lat: 47.4647, lon: 8.5492 },
    });

    expect(enriched.departure.lat).toBe(47.458056);
    expect(enriched.departure.lon).toBe(8.548056);
    expect(enriched.arrival.lat).toBe(47.458056);
    expect(enriched.arrival.lon).toBe(8.548056);
  });

  it("still fills the coordinate in when the caller supplies none", async () => {
    const enriched = await enrichFlightAirports({
      departure: { iata: "ZRH" },
      arrival: { iata: "ZRH" },
    });

    expect(enriched.departure.lat).toBe(47.458056);
    expect(enriched.departure.lon).toBe(8.548056);
  });

  it("keeps the caller coordinate for an airport the catalogue does not know", async () => {
    // No codes on purpose: that skips the IATA/ICAO strategies, which would
    // otherwise reach out to the external CSV, and exercises the
    // nearest-airport strategy instead. A test must not depend on the network.
    mockFindMany.mockResolvedValue([]);
    mockFindFirst.mockResolvedValue(null);

    const enriched = await enrichFlightAirports({
      departure: { lat: 12.5, lon: 34.75 },
      arrival: { lat: 12.5, lon: 34.75 },
    });

    expect(enriched.departure.lat).toBe(12.5);
    expect(enriched.departure.lon).toBe(34.75);
  });

  it("leaves the non-coordinate fields filling gaps as before", async () => {
    const enriched = await enrichFlightAirports({
      departure: { iata: "ZRH", name: "Kloten, as the user typed it" },
      arrival: { iata: "ZRH" },
    });

    // A caller-supplied NAME is still respected — only the position is owned
    // by the catalogue.
    expect(enriched.departure.name).toBe("Kloten, as the user typed it");
    expect(enriched.arrival.name).toBe("Zürich Airport");
  });
});
