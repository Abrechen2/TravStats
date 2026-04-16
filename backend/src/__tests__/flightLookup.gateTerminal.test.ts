/**
 * Regression tests for the 2026-04-16 flighttest-account bug where
 * `lookupFlightDetails` dropped `terminal`, `gate`, `actualDeparture`, and
 * `actualArrival` when assembling its FlightLookupResult. The airport object
 * returned by findOrCreateAirport carries only static metadata
 * (name/lat/lon/iata/icao) — per-flight fields must be merged on top, otherwise
 * the API's live data is silently wiped on every auto-update.
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
    // NOTE: airport records never carry terminal/gate — those are per-flight.
  })),
}));

jest.mock("../services/apiKeyResolver", () => ({
  // aviationstack stays unconfigured so we deterministically fall through to
  // AirLabs (the path this test suite exercises).
  getApiKey: jest.fn(async (provider: string) =>
    provider === "airlabs" ? "test-airlabs-key" : null,
  ),
  getOpenSkyCredentials: jest.fn(async () => null),
}));

jest.mock("../utils/timezone", () => ({
  convertAviationstackTimeToUtc: jest.fn(async (t: string) => t),
  convertAirlabsTimeToUtc: jest.fn(async (t: string) => t),
}));

jest.mock("../db", () => ({
  prisma: {
    userSettings: { findUnique: jest.fn() },
    apiKey: { findFirst: jest.fn() },
    setting: { findUnique: jest.fn() },
  },
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────
import { lookupFlightDetails } from "../services/flightLookup";

describe("lookupFlightDetails preserves per-flight AirLabs fields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("carries gate + terminal through the AirLabs fallback path", async () => {
    // AirLabs response shape — this is where LH400 was losing `dep_terminal`.
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

    const result = await lookupFlightDetails("XY100", "2026-05-01");

    expect(result).not.toBeNull();
    // The regression: before the fix, these were undefined because
    // findOrCreateAirport's return value shadowed the API data.
    expect(result?.departure?.terminal).toBe("1");
    expect(result?.departure?.gate).toBe("A21");
    expect(result?.arrival?.terminal).toBe("4");
    expect(result?.arrival?.gate).toBe("B07");

    // Sanity: static airport fields still come through from findOrCreateAirport
    expect(result?.departure?.iata).toBe("FRA");
    expect(result?.arrival?.iata).toBe("JFK");
  });

  it("exposes actualDeparture + actualArrival when AirLabs reports them", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        response: [
          {
            flight_iata: "XY200",
            airline_iata: "LH",
            dep_iata: "FRA",
            dep_icao: "EDDF",
            dep_time_utc: "2026-05-01T10:00:00.000Z",
            dep_actual_utc: "2026-05-01T10:12:00.000Z",
            arr_iata: "JFK",
            arr_icao: "KJFK",
            arr_time_utc: "2026-05-01T18:00:00.000Z",
            arr_actual_utc: "2026-05-01T18:05:00.000Z",
          },
        ],
      },
    });

    const result = await lookupFlightDetails("XY200", "2026-05-01");

    expect(result?.actualDeparture).toBe("2026-05-01T10:12:00.000Z");
    expect(result?.actualArrival).toBe("2026-05-01T18:05:00.000Z");
  });

  it("leaves actual_* undefined when the API does not report them", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        response: [
          {
            flight_iata: "XY300",
            airline_iata: "LH",
            dep_iata: "FRA",
            dep_icao: "EDDF",
            dep_time_utc: "2026-05-01T10:00:00.000Z",
            arr_iata: "JFK",
            arr_icao: "KJFK",
            arr_time_utc: "2026-05-01T18:00:00.000Z",
          },
        ],
      },
    });

    const result = await lookupFlightDetails("XY300", "2026-05-01");

    expect(result?.actualDeparture).toBeUndefined();
    expect(result?.actualArrival).toBeUndefined();
  });
});
