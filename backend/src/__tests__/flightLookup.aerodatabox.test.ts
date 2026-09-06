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
  // v1.5.1: aerodataboxLookup now backfills shortName/municipalityName onto
  // the local airport row. The unit test doesn't exercise the DB write —
  // a focused integration test in airportLookup.test.ts covers that
  // behaviour against a real DB. Here we just stub the call out so the
  // mapping tests aren't accidentally coupled to it.
  enrichAirportMetadata: jest.fn(async () => false),
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
import logger from "../utils/logger";
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

  // Seen on prod 2026-09-05: a 2xx whose body was an object, not a list.
  // `.filter` threw inside the try and the generic catch logged it as
  // "returned.filter is not a function" — a lookup failure with no cause.
  it("returns null and names the shape when the body is not a list", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");
    mockedAxios.get.mockResolvedValueOnce({ data: { message: "Flight not found" } });

    const result = await lookupFlightAerodatabox("BA2556", "2026-07-30");

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "unexpected_response_shape", receivedType: "object" }),
      expect.stringContaining("not a flight list"),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: "api_call_error" }),
      expect.anything(),
    );

    // Not cached — the next ask goes back to the provider.
    mockedAxios.get.mockResolvedValueOnce({ data: [] });
    await lookupFlightAerodatabox("BA2556", "2026-07-30");
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
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

  /**
   * The overnight case, from the owner's account on 2026-09-03. LX93
   * GRU→ZRH departs on the 2nd and lands on the 3rd, so a query for the 2nd
   * matches TWO flights: ours, and the one that left on the 1st and landed on
   * the 2nd. The picker chooses on codeshare grounds and knows nothing about
   * dates, so it returned the wrong day's flight — `flightAutoUpdate`'s
   * rotation guard then rejected it with "24h away from ours", twice, and the
   * flight kept no actual times at all.
   */
  it("ignores an entry that merely LANDS on the requested date", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          // Departed the 1st, landed the 2nd. AeroDataBox returns it for the
          // 2nd, and it is not our flight.
          number: "LX 93",
          codeshareStatus: "isOperator",
          airline: { name: "Swiss" },
          aircraft: { reg: "HB-WRONG" },
          departure: {
            airport: { iata: "GRU" },
            scheduledTime: { utc: "2026-09-01 21:25Z", local: "2026-09-01 18:25-03:00" },
          },
          arrival: {
            airport: { iata: "ZRH" },
            scheduledTime: { utc: "2026-09-02 08:40Z", local: "2026-09-02 10:40+02:00" },
          },
        },
        {
          number: "LX 93",
          codeshareStatus: "isOperator",
          airline: { name: "Swiss" },
          aircraft: { reg: "HB-JNG" },
          departure: {
            airport: { iata: "GRU" },
            scheduledTime: { utc: "2026-09-02 21:25Z", local: "2026-09-02 18:25-03:00" },
          },
          arrival: {
            airport: { iata: "ZRH" },
            scheduledTime: { utc: "2026-09-03 08:40Z", local: "2026-09-03 10:40+02:00" },
          },
        },
      ],
    });

    const result = await lookupFlightAerodatabox("LX93", "2026-09-02");

    expect(result?.aircraftRegistration).toBe("HB-JNG");
    expect(result?.departureTime).toBe("2026-09-02T21:25:00.000Z");
  });

  it("returns null when nothing in the response departs on the requested date", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          number: "LX 94",
          codeshareStatus: "isOperator",
          airline: { name: "Swiss" },
          departure: {
            airport: { iata: "GRU" },
            scheduledTime: { utc: "2026-09-01 21:25Z", local: "2026-09-01 18:25-03:00" },
          },
          arrival: {
            airport: { iata: "ZRH" },
            scheduledTime: { utc: "2026-09-02 08:40Z", local: "2026-09-02 10:40+02:00" },
          },
        },
      ],
    });

    // Better an honest nothing than the neighbouring day's aeroplane: the
    // rotation guard downstream would have discarded it anyway, two steps
    // later and under a message that blames the provider.
    const result = await lookupFlightAerodatabox("LX94", "2026-09-02");

    expect(result).toBeNull();
  });

  it("keeps an entry whose local departure time is missing", async () => {
    // The filter removes a wrong answer; it does not invent a stricter one.
    // Providers that answer without a local timestamp must still be usable.
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          number: "LX 95",
          codeshareStatus: "isOperator",
          airline: { name: "Swiss" },
          aircraft: { reg: "HB-ONLY" },
          departure: { airport: { iata: "GRU" }, scheduledTime: { utc: "2026-09-02 21:25Z" } },
          arrival: { airport: { iata: "ZRH" }, scheduledTime: { utc: "2026-09-03 08:40Z" } },
        },
      ],
    });

    const result = await lookupFlightAerodatabox("LX95", "2026-09-02");

    expect(result?.aircraftRegistration).toBe("HB-ONLY");
  });

  /**
   * The case that got past the date filter, found while backfilling the
   * owner's data by hand on 2026-09-03. LX93 on 2026-09-02 comes back THREE
   * times: the GRU→ZRH that left on the 1st and landed on the 2nd, an EZE→GRU
   * feeder that afternoon, and the GRU→ZRH he actually took. The date filter
   * removes the first and leaves two, and the codeshare-based pick then has a
   * one-in-two chance — it took the feeder, and its arrival time was written
   * onto the long-haul row before the mistake was caught.
   */
  it("picks the entry that leaves from OUR airport when a number flies twice a day", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");

    const feeder = {
      number: "LX 93",
      codeshareStatus: "isOperator",
      airline: { name: "Swiss" },
      aircraft: { reg: "HB-FEEDER" },
      departure: {
        airport: { iata: "EZE" },
        scheduledTime: { utc: "2026-09-02 16:30Z", local: "2026-09-02 13:30-03:00" },
      },
      arrival: {
        airport: { iata: "GRU" },
        scheduledTime: { utc: "2026-09-02 19:10Z", local: "2026-09-02 16:10-03:00" },
      },
    };
    const ours = {
      number: "LX 93",
      codeshareStatus: "isOperator",
      airline: { name: "Swiss" },
      aircraft: { reg: "HB-JNG" },
      departure: {
        airport: { iata: "GRU" },
        scheduledTime: { utc: "2026-09-02 21:25Z", local: "2026-09-02 18:25-03:00" },
      },
      arrival: {
        airport: { iata: "ZRH" },
        scheduledTime: { utc: "2026-09-03 08:40Z", local: "2026-09-03 10:40+02:00" },
      },
    };
    mockedAxios.get.mockResolvedValueOnce({ data: [feeder, ours] });

    const result = await lookupFlightAerodatabox("LX93", "2026-09-02", undefined, "GRU");

    expect(result?.aircraftRegistration).toBe("HB-JNG");
  });

  it("keeps every candidate when none matches the airport we were given", async () => {
    // A preference, not a filter. The stored code may be ICAO where the
    // provider answers IATA, or missing on an older row — in which case the
    // caller must be no worse off than before this existed.
    apiKeyResolverMock.getApiKey.mockImplementation(async () => "secret-key");
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          number: "LX 96",
          codeshareStatus: "isOperator",
          airline: { name: "Swiss" },
          aircraft: { reg: "HB-ONLY" },
          departure: { airport: { iata: "GRU" }, scheduledTime: { utc: "2026-09-02 21:25Z" } },
          arrival: { airport: { iata: "ZRH" }, scheduledTime: { utc: "2026-09-03 08:40Z" } },
        },
      ],
    });

    const result = await lookupFlightAerodatabox("LX96", "2026-09-02", undefined, "XXX");

    expect(result?.aircraftRegistration).toBe("HB-ONLY");
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

describe("aerodataboxLookup — extended-field mapping (v1.5)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetAerodataboxCacheForTests();
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) =>
      provider === "aerodatabox" ? "secret-key" : null,
    );
  });

  it("persists runwayTime, isCargo, qualityTags, baggageBelt, checkInDesk, lastUpdatedUtc", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          number: "LH400",
          codeshareStatus: "isOperator",
          isCargo: false,
          lastUpdatedUtc: "2024-01-15 18:30Z",
          quality: ["Basic", "Live"],
          airline: { name: "Lufthansa", iata: "LH", icao: "DLH" },
          aircraft: { reg: "D-AIBL", model: "Airbus A320" },
          departure: {
            airport: { iata: "FRA", icao: "EDDF", name: "Frankfurt" },
            scheduledTime: { utc: "2024-01-15 10:30Z" },
            runwayTime: { utc: "2024-01-15 10:42Z" },
            terminal: "1",
            gate: "A12",
            checkInDesk: "120-150",
            baggageBelt: "7",
          },
          arrival: {
            airport: { iata: "JFK", icao: "KJFK", name: "JFK" },
            scheduledTime: { utc: "2024-01-15 18:30Z" },
            runwayTime: { utc: "2024-01-15 18:25Z" },
            terminal: "1",
            gate: "B14",
            baggageBelt: "3",
          },
        },
      ],
    });

    const result = await lookupFlightAerodatabox("LH400", "2024-01-15");

    expect(result).not.toBeNull();
    expect(result?.runwayDepartureTime?.toISOString()).toBe("2024-01-15T10:42:00.000Z");
    expect(result?.runwayArrivalTime?.toISOString()).toBe("2024-01-15T18:25:00.000Z");
    expect(result?.isCargo).toBe(false);
    expect(result?.aerodataboxQualityTags).toEqual(["Basic", "Live"]);
    expect(result?.baggageBelt).toBe("3");       // arrival side — passenger picks up here
    expect(result?.checkInDesk).toBe("120-150"); // departure side — passenger checks in here
    expect(result?.aerodataboxLastUpdatedUtc?.toISOString()).toBe("2024-01-15T18:30:00.000Z");
  });
});
