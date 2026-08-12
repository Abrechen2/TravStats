/**
 * Two defects on the AirLabs path, both measured against the live API on
 * 2026-08-11 while chasing "EK051 finds nothing":
 *
 * 1. The query carried the stored, zero-padded number. `flight_iata=EK051`
 *    returns 0 records; `flight_iata=EK51` returns the flight.
 * 2. AirLabs returns `dep_time` (airport-local) AND `dep_time_utc`, both in
 *    the bare form "YYYY-MM-DD HH:mm" with no zone marker. Preferring the
 *    `_utc` field handed an unmarked value to `convertAirlabsTimeToUtc`,
 *    which decides by that missing marker and re-interpreted it as local —
 *    subtracting the airport offset a second time.
 *
 * A third rule falls out of the first: the response must be mapped back onto
 * the CALLER's spelling, or auto-apply sees a flightNumber change and renames
 * the user's flight to the provider's convention.
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

jest.mock("../services/apiKeyResolver", () => ({
  // Only AirLabs configured, so the lookup deterministically takes that path.
  getApiKey: jest.fn(async (provider: string) =>
    provider === "airlabs" ? "test-airlabs-key" : null,
  ),
  getOpenSkyCredentials: jest.fn(async () => null),
}));

jest.mock("../utils/timezone", () => ({
  // Identity converters: the assertions are about what flightLookup HANDS to
  // the converter, which is exactly where the double-conversion originated.
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

/**
 * `flightLookup` keeps a module-level NodeCache keyed by number + date that
 * `jest.clearAllMocks()` does not touch, so every test below queries its OWN
 * date. Reusing one date makes later tests silently assert the first test's
 * cached result.
 */
const dateFor = (test: number): string => `2026-08-${11 + test}`;

/** The shape AirLabs actually returns: bare "YYYY-MM-DD HH:mm", no zone. */
const airlabsResponse = (flightIata: string) => ({
  data: {
    response: [
      {
        flight_iata: flightIata,
        airline_name: "Emirates",
        airline_iata: "EK",
        dep_iata: "DXB",
        dep_icao: "OMDB",
        dep_time: "2026-08-11 15:55",
        dep_time_utc: "2026-08-11 11:55",
        arr_iata: "MUC",
        arr_icao: "EDDM",
        arr_time: "2026-08-11 19:20",
        arr_time_utc: "2026-08-11 17:20",
        aircraft_icao: "B77W",
      },
    ],
  },
});

describe("AirLabs lookup uses the provider's flight-number form", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("queries the UNPADDED number for a zero-padded flight", async () => {
    mockedAxios.get.mockResolvedValueOnce(airlabsResponse("EK51"));

    await lookupFlightDetails("EK051", dateFor(0));

    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://airlabs.co/api/v9/schedules",
      expect.objectContaining({
        params: expect.objectContaining({ flight_iata: "EK51" }),
      }),
    );
  });

  it("echoes back the CALLER's padded spelling, not the provider's", async () => {
    mockedAxios.get.mockResolvedValueOnce(airlabsResponse("EK51"));

    const result = await lookupFlightDetails("EK051", dateFor(1));

    // Returning "EK51" here is what auto-apply would write over the user's
    // stored "EK051" — a silent rename.
    expect(result?.flightNumber).toBe("EK051");
  });
});

describe("AirLabs *_utc values are tagged as UTC before conversion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("marks the bare _utc departure value with a zone", async () => {
    mockedAxios.get.mockResolvedValueOnce(airlabsResponse("EK51"));

    const result = await lookupFlightDetails("EK051", dateFor(2));

    // The converter is mocked to identity, so this asserts EXACTLY what
    // flightLookup hands it. Unmarked, "2026-08-11 11:55" would read as
    // Dubai-local and come out as 07:55Z.
    expect(result?.departureTime).toBe("2026-08-11T11:55Z");
  });

  it("marks the bare _utc arrival value with a zone", async () => {
    mockedAxios.get.mockResolvedValueOnce(airlabsResponse("EK51"));

    const result = await lookupFlightDetails("EK051", dateFor(3));

    expect(result?.arrivalTime).toBe("2026-08-11T17:20Z");
  });

  it("leaves a value that already carries a zone untouched", async () => {
    const withZone = airlabsResponse("EK51");
    withZone.data.response[0].dep_time_utc = "2026-08-11T11:55:00.000Z";
    mockedAxios.get.mockResolvedValueOnce(withZone);

    const result = await lookupFlightDetails("EK051", dateFor(4));

    expect(result?.departureTime).toBe("2026-08-11T11:55:00.000Z");
  });

  it("falls back to the local field when no _utc value is present", async () => {
    const localOnly = airlabsResponse("EK51");
    localOnly.data.response[0].dep_time_utc = "";
    mockedAxios.get.mockResolvedValueOnce(localOnly);

    const result = await lookupFlightDetails("EK051", dateFor(5));

    // Untagged on purpose — the converter must treat this one as local.
    expect(result?.departureTime).toBe("2026-08-11 15:55");
  });
});
