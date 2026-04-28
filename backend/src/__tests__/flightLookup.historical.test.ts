/**
 * Regression tests for issue #82 and follow-ups.
 *
 * The previous `/api/v1/flight-lookup/:flightNumber` route went straight to
 * AirLabs `/schedules`, which silently ignored `dep_date` for non-today
 * lookups and returned today's schedule. The wrapper
 * `lookupFlightWithHistorical` now:
 *   - Routes through the full provider cascade (Aviationstack -> AirLabs).
 *   - Reports `unavailableReason: 'no_provider'` for any non-today request
 *     when no Aviationstack key is configured. The free providers only
 *     cover live (today) data — AirLabs lies about other dates and
 *     OpenSky has no working callsign-by-date REST endpoint.
 *   - Reports `unavailableReason: 'no_match'` when a live-window lookup
 *     (today) returned nothing — a typo is plausible there.
 *   - Reports `unavailableReason: 'no_match_api_gap'` when an out-of-live-window
 *     lookup returned nothing OR returned today's schedule for a non-today
 *     request (issue #82 root symptom). The flight just isn't covered by the
 *     API for that date — the user shouldn't be told to check their input.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import axios from "axios";

// ─── Mocks ──────────────────────────────────────────────────────────────────

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

// ─── Import after mocks ─────────────────────────────────────────────────────
import {
  lookupFlightWithHistorical,
  __resetAviationstackBudgetForTests,
} from "../services/flightLookup";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe("lookupFlightWithHistorical", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetAviationstackBudgetForTests();
    apiKeyResolverMock.getApiKey.mockImplementation(async () => null);
    apiKeyResolverMock.getOpenSkyCredentials.mockImplementation(async () => null);
  });

  it("returns FlightData[] shape for today's flight via AirLabs", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) =>
      provider === "airlabs" ? "test-airlabs-key" : null,
    );

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        response: [
          {
            flight_iata: "XY100",
            airline_name: "Lufthansa",
            airline_iata: "LH",
            dep_iata: "FRA",
            dep_icao: "EDDF",
            dep_time_utc: "2026-05-01T10:00:00.000Z",
            dep_terminal: "1",
            dep_gate: "A21",
            arr_iata: "JFK",
            arr_icao: "KJFK",
            arr_time_utc: "2026-05-01T18:00:00.000Z",
            arr_terminal: "4",
            arr_gate: "B07",
            aircraft_icao: "B744",
          },
        ],
      },
    });

    const result = await lookupFlightWithHistorical("XY100", undefined);

    expect(result.unavailableReason).toBeUndefined();
    expect(result.flights).toHaveLength(1);
    const flight = result.flights[0];
    expect(flight.flightNumber).toBe("XY100");
    expect(flight.departure.iata).toBe("FRA");
    expect(flight.departure.scheduledTime).toBe("2026-05-01T10:00:00.000Z");
    expect(flight.departure.terminal).toBe("1");
    expect(flight.departure.gate).toBe("A21");
    expect(flight.arrival.iata).toBe("JFK");
    expect(flight.arrival.scheduledTime).toBe("2026-05-01T18:00:00.000Z");
    expect(flight.aircraft).toBe("B744");
  });

  it("reports no_provider for any past date when no Aviationstack key is configured", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) =>
      provider === "airlabs" ? "test-airlabs-key" : null,
    );

    const oldDate = new Date(Date.now() - 90 * ONE_DAY_MS);
    const result = await lookupFlightWithHistorical("XY100", oldDate);

    expect(result.unavailableReason).toBe("no_provider");
    expect(result.flights).toEqual([]);
    // Critical: must NOT have called any external provider — that's the bug we're fixing.
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("reports no_provider for any future date when no Aviationstack key is configured", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) =>
      provider === "airlabs" ? "test-airlabs-key" : null,
    );

    const futureDate = new Date(Date.now() + 30 * ONE_DAY_MS);
    const result = await lookupFlightWithHistorical("XY200", futureDate);

    expect(result.unavailableReason).toBe("no_provider");
    expect(result.flights).toEqual([]);
    // Free providers can't serve future schedules — must fail fast.
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("reports no_provider for a recent past date (yesterday) when no Aviationstack key is configured", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) =>
      provider === "airlabs" ? "test-airlabs-key" : null,
    );

    const yesterday = new Date(Date.now() - ONE_DAY_MS);
    const result = await lookupFlightWithHistorical("XY100", yesterday);

    // Free tier no longer claims to cover the last ~30 days via OpenSky —
    // its REST callsign endpoint doesn't exist, so any non-today lookup
    // requires Aviationstack.
    expect(result.unavailableReason).toBe("no_provider");
    expect(result.flights).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("attempts the cascade for past dates when Aviationstack key is present", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) => {
      if (provider === "airlabs") return "test-airlabs-key";
      if (provider === "aviationstack") return "test-aviationstack-key";
      return null;
    });

    mockedAxios.get.mockResolvedValueOnce({ data: { data: [] } }); // Aviationstack: empty
    mockedAxios.get.mockResolvedValueOnce({ data: { response: [] } }); // AirLabs: empty

    const oldDate = new Date(Date.now() - 90 * ONE_DAY_MS);
    const result = await lookupFlightWithHistorical("XY100", oldDate);

    // Aviationstack returned empty -> AirLabs returned empty -> no_match_api_gap
    // (out-of-live-window with key configured: API gap, not a user typo)
    expect(result.flights).toEqual([]);
    expect(result.unavailableReason).toBe("no_match_api_gap");
    expect(mockedAxios.get).toHaveBeenCalled();
  });

  it("treats today's-schedule responses to past queries as no_match_api_gap — far past (issue #82)", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) => {
      if (provider === "airlabs") return "test-airlabs-key";
      if (provider === "aviationstack") return "test-aviationstack-key";
      return null;
    });

    const todayIso = new Date().toISOString().slice(0, 10);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          {
            airline: { name: "Lufthansa" },
            flight: { iata: "QQ100" },
            departure: { iata: "FRA", scheduled: `${todayIso}T08:55:00.000Z` },
            arrival: { iata: "JFK", scheduled: `${todayIso}T18:00:00.000Z` },
          },
        ],
      },
    });

    const oldDate = new Date(Date.now() - 90 * ONE_DAY_MS);
    const result = await lookupFlightWithHistorical("QQ100", oldDate);

    expect(result.flights).toEqual([]);
    expect(result.unavailableReason).toBe("no_match_api_gap");
  });

  it("treats today's-schedule responses to yesterday queries as no_match_api_gap (smoking-gun heuristic)", async () => {
    // |dayDiff| == 1 alone wouldn't trip the strict-mismatch check (which
    // tolerates 1-day timezone shifts). The smoking-gun heuristic catches it
    // because the returned date is *today* and the user did not ask for today.
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) => {
      if (provider === "airlabs") return "test-airlabs-key";
      if (provider === "aviationstack") return "test-aviationstack-key";
      return null;
    });

    const todayIso = new Date().toISOString().slice(0, 10);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          {
            airline: { name: "Lufthansa" },
            flight: { iata: "QQ200" },
            departure: { iata: "FRA", scheduled: `${todayIso}T08:55:00.000Z` },
            arrival: { iata: "JFK", scheduled: `${todayIso}T18:00:00.000Z` },
          },
        ],
      },
    });

    const yesterday = new Date(Date.now() - ONE_DAY_MS);
    const result = await lookupFlightWithHistorical("QQ200", yesterday);

    expect(result.flights).toEqual([]);
    expect(result.unavailableReason).toBe("no_match_api_gap");
  });

  it("treats today's-schedule responses to tomorrow queries as no_match_api_gap (smoking-gun future)", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) => {
      if (provider === "airlabs") return "test-airlabs-key";
      if (provider === "aviationstack") return "test-aviationstack-key";
      return null;
    });

    const todayIso = new Date().toISOString().slice(0, 10);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          {
            airline: { name: "Lufthansa" },
            flight: { iata: "QQ300" },
            departure: { iata: "FRA", scheduled: `${todayIso}T08:55:00.000Z` },
            arrival: { iata: "JFK", scheduled: `${todayIso}T18:00:00.000Z` },
          },
        ],
      },
    });

    const tomorrow = new Date(Date.now() + ONE_DAY_MS);
    const result = await lookupFlightWithHistorical("QQ300", tomorrow);

    expect(result.flights).toEqual([]);
    expect(result.unavailableReason).toBe("no_match_api_gap");
  });

  it("returns an empty array (no unavailableReason) when today's lookup finds nothing", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) =>
      provider === "airlabs" ? "test-airlabs-key" : null,
    );

    mockedAxios.get.mockResolvedValueOnce({ data: { response: [] } });

    // Use a different flight number to avoid the in-memory result cache hit
    // from earlier tests in this file (the cache is keyed by `${flightNumber}_${dateStr}`).
    const result = await lookupFlightWithHistorical("ZZ999", undefined);

    expect(result.flights).toEqual([]);
    expect(result.unavailableReason).toBeUndefined();
  });
});
