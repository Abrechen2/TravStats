/**
 * Tests for the AeroDataBox provider adapter and its integration into the
 * flight-lookup cascade.
 *
 * Two slices:
 *   1. Direct unit tests of `lookupFlightAerodatabox` — request shape,
 *      response mapping, codeshare deduplication, error handling.
 *   2. Cascade tests of `lookupFlightWithHistorical` to confirm an
 *      AeroDataBox-only configuration unblocks the historical no_provider
 *      gate (the gap that AirLabs / Aviationstack-Free leave open).
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../services/airportLookup", () => ({
  findOrCreateAirport: jest.fn(async (code: string) => ({
    iata: code,
    icao: code,
    name: `${code} International`,
    lat: 0,
    lon: 0,
  })),
}));

const apiKeyResolverMock = {
  getApiKey: jest.fn(async (_provider: string, _userId?: string) => null as string | null),
  getOpenSkyCredentials: jest.fn(async () => null as { user?: string; pass?: string } | null),
};
jest.mock("../services/apiKeyResolver", () => apiKeyResolverMock);

jest.mock("../utils/timezone", () => ({
  convertAviationstackTimeToUtc: jest.fn(async (t: string) => t),
  convertAirlabsTimeToUtc: jest.fn(async (t: string) => t),
}));

jest.mock("../db", () => ({
  prisma: {
    userSettings: { findUnique: jest.fn() },
    apiKey: { findFirst: jest.fn() },
    setting: { findUnique: jest.fn() },
    adminSettings: { findFirst: jest.fn(async () => null) },
  },
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { lookupFlightAerodatabox, __resetAerodataboxCacheForTests } from "../services/aerodataboxLookup";
import {
  lookupFlightWithHistorical,
  __resetAviationstackBudgetForTests,
} from "../services/flightLookup";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe("lookupFlightAerodatabox", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetAerodataboxCacheForTests();
    apiKeyResolverMock.getApiKey.mockImplementation(async () => null);
  });

  it("returns null when no AeroDataBox key is configured", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => null);

    const result = await lookupFlightAerodatabox("LH400", "2026-04-15");

    expect(result).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("calls AeroDataBox with the RapidAPI host + key headers", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) =>
      provider === "aerodatabox" ? "secret-key" : null,
    );

    mockedAxios.get.mockResolvedValueOnce({ data: [] });

    await lookupFlightAerodatabox("LH400", "2026-04-15");

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    const [url, config] = mockedAxios.get.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain("aerodatabox.p.rapidapi.com");
    expect(url).toContain("/flights/number/LH400/2026-04-15");
    expect(config.headers["x-rapidapi-host"]).toBe("aerodatabox.p.rapidapi.com");
    expect(config.headers["x-rapidapi-key"]).toBe("secret-key");
  });

  it("normalizes whitespace in the flight number before calling the API", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");
    mockedAxios.get.mockResolvedValueOnce({ data: [] });

    await lookupFlightAerodatabox("lh 400", "2026-04-15");

    const [url] = mockedAxios.get.mock.calls[0] as [string];
    expect(url).toContain("/flights/number/LH400/2026-04-15");
  });

  it("maps a successful response to FlightLookupResult shape", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          number: "LH 400",
          callSign: "DLH400",
          codeshareStatus: "isOperator",
          status: "Arrived",
          aircraft: { reg: "D-AIHB", model: "Airbus A340-642", modeS: "3C6512" },
          airline: { name: "Lufthansa", iata: "LH", icao: "DLH" },
          greatCircleDistance: { km: 6204.69, mile: 3855.42 },
          departure: {
            airport: { iata: "FRA", icao: "EDDF", name: "Frankfurt" },
            scheduledTime: { utc: "2024-01-15 17:30Z" },
            actualTime: { utc: "2024-01-15 17:42Z" },
            terminal: "1",
            gate: "A12",
          },
          arrival: {
            airport: { iata: "JFK", icao: "KJFK", name: "John F Kennedy" },
            scheduledTime: { utc: "2024-01-16 02:30Z" },
            actualTime: { utc: "2024-01-16 02:18Z" },
            terminal: "1",
            gate: "B07",
          },
        },
      ],
    });

    const result = await lookupFlightAerodatabox("LH400", "2024-01-15");

    expect(result).not.toBeNull();
    expect(result?.airline).toBe("Lufthansa");
    expect(result?.flightNumber).toBe("LH400");
    expect(result?.aircraft).toBe("Airbus A340-642");
    expect(result?.departure?.iata).toBe("FRA");
    expect(result?.departure?.terminal).toBe("1");
    expect(result?.departure?.gate).toBe("A12");
    expect(result?.arrival?.iata).toBe("JFK");
    expect(result?.departureTime).toBe("2024-01-15T17:30:00.000Z");
    expect(result?.actualDeparture).toBe("2024-01-15T17:42:00.000Z");
    // Phase-1 enrichment fields
    expect(result?.aircraftRegistration).toBe("D-AIHB");
    expect(result?.aircraftModeS).toBe("3C6512");
    expect(result?.callsign).toBe("DLH400");
    expect(result?.airlineIata).toBe("LH");
    expect(result?.airlineIcao).toBe("DLH");
    expect(result?.distanceKm).toBe(6204.69);
    expect(result?.isCodeshare).toBe(false);
    expect(result?.operatingAirline).toBeUndefined();
    expect(result?.statusOverride).toBeUndefined();
  });

  it("flags codeshare entries and exposes marketing + operating airline", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        // Marketing partner (matches the searched number)
        {
          number: "UA 8842",
          codeshareStatus: "isCodeshare",
          airline: { name: "United Airlines", iata: "UA", icao: "UAL" },
          departure: { airport: { iata: "FRA" }, scheduledTime: { utc: "2024-01-15 17:30Z" } },
          arrival: { airport: { iata: "JFK" }, scheduledTime: { utc: "2024-01-16 02:30Z" } },
        },
        // Operator (different number, does the actual flying)
        {
          number: "LH 400",
          callSign: "DLH400",
          codeshareStatus: "isOperator",
          aircraft: { reg: "D-AIHB", model: "Airbus A340-642" },
          airline: { name: "Lufthansa", iata: "LH", icao: "DLH" },
          departure: { airport: { iata: "FRA" }, scheduledTime: { utc: "2024-01-15 17:30Z" } },
          arrival: { airport: { iata: "JFK" }, scheduledTime: { utc: "2024-01-16 02:30Z" } },
        },
      ],
    });

    const result = await lookupFlightAerodatabox("UA8842", "2024-01-15");

    expect(result?.isCodeshare).toBe(true);
    expect(result?.airline).toBe("United Airlines");
    expect(result?.flightNumber).toBe("UA8842");
    expect(result?.airlineIata).toBe("UA");
    expect(result?.operatingAirline).toBe("Lufthansa");
    // Operator-specific metadata still comes from the operator entry
    expect(result?.aircraftRegistration).toBe("D-AIHB");
    expect(result?.callsign).toBe("DLH400");
  });

  it("maps Cancelled and Diverted statuses to statusOverride", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          number: "LH 400",
          codeshareStatus: "isOperator",
          status: "Cancelled",
          airline: { name: "Lufthansa" },
          departure: { airport: { iata: "FRA" }, scheduledTime: { utc: "2024-01-15 17:30Z" } },
          arrival: { airport: { iata: "JFK" }, scheduledTime: { utc: "2024-01-16 02:30Z" } },
        },
      ],
    });

    const result = await lookupFlightAerodatabox("LH400", "2024-01-15");
    expect(result?.statusOverride).toBe("cancelled");
  });

  it("prefers the operator entry over codeshare entries", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          number: "UA 9001",
          codeshareStatus: "isCodeshare",
          airline: { name: "United" },
          departure: { airport: { iata: "FRA" }, scheduledTime: { utc: "2024-01-15 17:30Z" } },
          arrival: { airport: { iata: "JFK" }, scheduledTime: { utc: "2024-01-16 02:30Z" } },
        },
        {
          number: "LH 400",
          codeshareStatus: "isOperator",
          airline: { name: "Lufthansa" },
          departure: { airport: { iata: "FRA" }, scheduledTime: { utc: "2024-01-15 17:30Z" } },
          arrival: { airport: { iata: "JFK" }, scheduledTime: { utc: "2024-01-16 02:30Z" } },
        },
      ],
    });

    const result = await lookupFlightAerodatabox("LH400", "2024-01-15");

    expect(result?.airline).toBe("Lufthansa");
    expect(result?.flightNumber).toBe("LH400");
  });

  it("returns null when the response is empty", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");
    mockedAxios.get.mockResolvedValueOnce({ data: [] });

    const result = await lookupFlightAerodatabox("XX9999", "2024-01-15");
    expect(result).toBeNull();
  });

  it("swallows 429 quota errors and returns null", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 429 } });

    const result = await lookupFlightAerodatabox("LH400", "2024-01-15");
    expect(result).toBeNull();
  });

  it("swallows 401 auth errors and returns null", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "bad-key");
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 401 } });

    const result = await lookupFlightAerodatabox("LH400", "2024-01-15");
    expect(result).toBeNull();
  });

  it("caches results so a second call with the same key does not re-hit the API", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          number: "LH 400",
          codeshareStatus: "isOperator",
          airline: { name: "Lufthansa" },
          departure: { airport: { iata: "FRA" }, scheduledTime: { utc: "2024-01-15 17:30Z" } },
          arrival: { airport: { iata: "JFK" }, scheduledTime: { utc: "2024-01-16 02:30Z" } },
        },
      ],
    });

    const first = await lookupFlightAerodatabox("LH400", "2024-01-15");
    const second = await lookupFlightAerodatabox("LH400", "2024-01-15");

    expect(first?.airline).toBe("Lufthansa");
    expect(second?.airline).toBe("Lufthansa");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});

describe("lookupFlightWithHistorical — AeroDataBox cascade integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetAerodataboxCacheForTests();
    __resetAviationstackBudgetForTests();
    apiKeyResolverMock.getApiKey.mockImplementation(async () => null);
  });

  it("does NOT return no_provider for a past date when only AeroDataBox is configured", async () => {
    // Critical regression guard for the v1.9 rollout: before AeroDataBox,
    // the historical gate hard-required Aviationstack. The new gate must
    // accept AeroDataBox alone.
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) =>
      provider === "aerodatabox" ? "secret-aerodatabox-key" : null,
    );

    const requestedDate = new Date(Date.now() - 90 * ONE_DAY_MS);
    const isoDate = requestedDate.toISOString().slice(0, 10);

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          number: "LH 400",
          codeshareStatus: "isOperator",
          airline: { name: "Lufthansa" },
          aircraft: { model: "Airbus A340-642" },
          departure: {
            airport: { iata: "FRA" },
            scheduledTime: { utc: `${isoDate} 17:30Z` },
            terminal: "1",
            gate: "A12",
          },
          arrival: {
            airport: { iata: "JFK" },
            scheduledTime: { utc: `${isoDate} 22:30Z` },
          },
        },
      ],
    });

    const result = await lookupFlightWithHistorical("LH400", requestedDate);

    expect(result.unavailableReason).toBeUndefined();
    expect(result.flights).toHaveLength(1);
    expect(result.flights[0].airline).toBe("Lufthansa");
    expect(result.flights[0].departure.iata).toBe("FRA");
    expect(result.flights[0].departure.gate).toBe("A12");
  });

  it("still returns no_provider for past dates when neither Aviationstack nor AeroDataBox is configured", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) =>
      provider === "airlabs" ? "test-airlabs-key" : null,
    );

    const oldDate = new Date(Date.now() - 90 * ONE_DAY_MS);
    const result = await lookupFlightWithHistorical("XY100", oldDate);

    expect(result.unavailableReason).toBe("no_provider");
    expect(result.flights).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
