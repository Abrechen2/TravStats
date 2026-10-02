/**
 * Tests for the FlightAware AeroAPI provider adapter, its place at the head of
 * the lookup cascade, and its key tester.
 *
 * The fixture (`fixtures/aeroapi-flight.json`) is DOCS-DERIVED: it follows the
 * field names of FlightAware's published AeroAPI v4 schema (BaseFlight /
 * FlightAirportRef, GET /flights/{ident}) and was NOT recorded from a live
 * response — that needs the owner's AeroAPI key. Replace it with a recorded
 * body once one exists.
 *
 * No real network: axios is mocked, as in flightLookup.aerodatabox.test.ts.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import axios from "axios";
import fixture from "./fixtures/aeroapi-flight.json";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../services/airportLookup", () => ({
  findOrCreateAirport: jest.fn(async (code: string) => ({
    iata: code,
    icao: `I${code}`,
    name: `${code} International`,
    lat: 1,
    lon: 2,
  })),
  enrichAirportMetadata: jest.fn(async () => false),
}));

const apiKeyResolverMock = {
  getApiKey: jest.fn(async (_provider: string, _userId?: string) => null as string | null),
  getOpenSkyCredentials: jest.fn(async () => null as { user?: string; pass?: string } | null),
};
jest.mock("../services/apiKeyResolver", () => apiKeyResolverMock);

jest.mock("../utils/timezone", () => ({
  ...(jest.requireActual("../utils/timezone") as object),
  getAirportTimezone: jest.fn(async () => null),
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

import { lookupFlightAeroapi, __resetAeroapiCacheForTests } from "../services/aeroapiLookup";
import { __resetAerodataboxCacheForTests } from "../services/aerodataboxLookup";
import { lookupFlightDetails, __resetAviationstackBudgetForTests } from "../services/flightLookup";
import { LookupOutcomeLog } from "../services/flightLookup/providerOutcome";
import { findOrCreateAirport } from "../services/airportLookup";
import { testAeroapiKey } from "../services/apiKeyTester";
import logger from "../utils/logger";

type Flight = (typeof fixture.flights)[number];

/** "Now" for every test: inside AeroAPI's -10 d / +2 d window for 2026-10-05. */
const NOW = Date.parse("2026-10-05T08:00:00Z");

const onlyAeroapiKey = () =>
  apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) =>
    provider === "aeroapi" ? "aeroapi-secret" : null
  );

const respondWith = (flights: Flight[]) =>
  mockedAxios.get.mockResolvedValueOnce({ data: { flights, links: null, num_pages: 1 } });

const dayOf = (scheduledOut: string): Flight =>
  fixture.flights.find((f) => f.scheduled_out.startsWith(scheduledOut))!;

beforeEach(() => {
  jest.clearAllMocks();
  __resetAeroapiCacheForTests();
  __resetAerodataboxCacheForTests();
  __resetAviationstackBudgetForTests();
  apiKeyResolverMock.getApiKey.mockImplementation(async () => null);
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("lookupFlightAeroapi", () => {
  it("returns null without a request when no AeroAPI key is configured", async () => {
    const result = await lookupFlightAeroapi("LH400", "2026-10-05");

    expect(result).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("asks /flights/{ident} with the x-apikey header and a window around the date", async () => {
    onlyAeroapiKey();
    respondWith([]);

    await lookupFlightAeroapi("LH 0400", "2026-10-05");

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    const [url, config] = mockedAxios.get.mock.calls[0] as [
      string,
      { headers: Record<string, string>; params: Record<string, string>; timeout: number },
    ];
    expect(url).toBe("https://aeroapi.flightaware.com/aeroapi/flights/LH400");
    expect(config.headers["x-apikey"]).toBe("aeroapi-secret");
    expect(config.params.ident_type).toBe("designator");
    expect(config.params.start).toBe("2026-10-04T00:00:00Z");
    // date + 2 days would be past AeroAPI's +2 d limit from NOW — clamped.
    expect(Date.parse(config.params.end)).toBeLessThanOrEqual(NOW + 2 * 24 * 3600 * 1000);
    expect(Date.parse(config.params.end)).toBeGreaterThan(Date.parse("2026-10-06T00:00:00Z"));
    expect(config.timeout).toBe(8000);
  });

  it("maps the instance departing on the requested date, scheduled times as the plan", async () => {
    onlyAeroapiKey();
    respondWith(fixture.flights);

    const result = await lookupFlightAeroapi("LH400", "2026-10-05");

    expect(result).not.toBeNull();
    expect(findOrCreateAirport).toHaveBeenCalledWith("FRA");
    expect(findOrCreateAirport).toHaveBeenCalledWith("JFK");
    expect(result).toMatchObject({
      flightNumber: "LH400",
      airlineIata: "LH",
      airlineIcao: "DLH",
      aircraft: "B748",
      aircraftRegistration: "D-ABYA",
      callsign: "DLH400",
      departureTime: "2026-10-05T11:55:00.000Z",
      arrivalTime: "2026-10-05T20:45:00.000Z",
      actualDeparture: "2026-10-05T12:20:00.000Z",
      actualArrival: "2026-10-05T21:00:00.000Z",
      baggageBelt: "6",
      departure: { iata: "FRA", icao: "IFRA", terminal: "1", gate: "Z25", lat: 1, lon: 2 },
      arrival: { iata: "JFK", terminal: "1", gate: "B32" },
    });
    expect(result?.runwayDepartureTime).toEqual(new Date("2026-10-05T12:38:00Z"));
    expect(result?.runwayArrivalTime).toEqual(new Date("2026-10-05T20:49:00Z"));
    expect(result?.statusOverride).toBeUndefined();
  });

  it("reads the requested date in the ORIGIN's zone, not in UTC", async () => {
    onlyAeroapiKey();
    // 23:30Z on the 4th is 01:30 on the 5th in Frankfurt.
    const lateEvening: Flight = {
      ...dayOf("2026-10-04"),
      scheduled_out: "2026-10-04T23:30:00Z",
      gate_origin: "A1",
    };
    respondWith([dayOf("2026-10-06"), lateEvening]);

    const result = await lookupFlightAeroapi("LH400", "2026-10-05");

    expect(result?.departureTime).toBe("2026-10-04T23:30:00.000Z");
    expect(result?.departure?.gate).toBe("A1");
  });

  it("returns null (no_match) when no instance departs on the requested date", async () => {
    onlyAeroapiKey();
    respondWith([dayOf("2026-10-06"), dayOf("2026-10-04")]);
    const outcomes = new LookupOutcomeLog();

    const result = await lookupFlightAeroapi("LH400", "2026-10-05", undefined, undefined, outcomes);

    expect(result).toBeNull();
    expect(outcomes.all()).toEqual([{ provider: "aeroapi", outcome: "no_match" }]);
  });

  it("maps cancelled: true to statusOverride cancelled", async () => {
    onlyAeroapiKey();
    respondWith([{ ...dayOf("2026-10-05"), cancelled: true }]);

    const result = await lookupFlightAeroapi("LH400", "2026-10-05");

    expect(result?.statusOverride).toBe("cancelled");
  });

  it("maps diverted: true to statusOverride diverted", async () => {
    onlyAeroapiKey();
    respondWith([{ ...dayOf("2026-10-05"), diverted: true }]);

    const result = await lookupFlightAeroapi("LH400", "2026-10-05");

    expect(result?.statusOverride).toBe("diverted");
  });

  it("prefers the instance leaving from OUR airport", async () => {
    onlyAeroapiKey();
    const feeder: Flight = {
      ...dayOf("2026-10-05"),
      origin: { ...dayOf("2026-10-05").origin, code: "EDDM", code_iata: "MUC", code_icao: "EDDM" },
      gate_origin: "G1",
    };
    respondWith([feeder, dayOf("2026-10-05")]);

    const result = await lookupFlightAeroapi("LH400", "2026-10-05", undefined, "EDDF");

    expect(result?.departure?.gate).toBe("Z25");
  });

  it("records 401 as auth and returns null", async () => {
    onlyAeroapiKey();
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 401, headers: {} } });
    const outcomes = new LookupOutcomeLog();

    const result = await lookupFlightAeroapi("LH400", "2026-10-05", undefined, undefined, outcomes);

    expect(result).toBeNull();
    expect(outcomes.all()).toEqual([{ provider: "aeroapi", outcome: "auth" }]);
  });

  it("records 429 as quota and returns null", async () => {
    onlyAeroapiKey();
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 429, headers: {} } });
    const outcomes = new LookupOutcomeLog();

    const result = await lookupFlightAeroapi("LH400", "2026-10-05", undefined, undefined, outcomes);

    expect(result).toBeNull();
    expect(outcomes.all()).toEqual([{ provider: "aeroapi", outcome: "quota" }]);
  });

  it("does not ask for a date outside AeroAPI's window", async () => {
    onlyAeroapiKey();

    const result = await lookupFlightAeroapi("LH400", "2026-05-01");

    expect(result).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("never writes the key into a log line", async () => {
    onlyAeroapiKey();
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 500, headers: {} } });

    await lookupFlightAeroapi("LH400", "2026-10-05");

    const logged = JSON.stringify([
      (logger.info as jest.Mock).mock.calls,
      (logger.warn as jest.Mock).mock.calls,
      (logger.debug as jest.Mock).mock.calls,
      (logger.error as jest.Mock).mock.calls,
    ]);
    expect(logged).not.toContain("aeroapi-secret");
  });
});

describe("lookupFlightDetails — AeroAPI goes first", () => {
  it("serves from AeroAPI when it has a key, before AeroDataBox", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) =>
      provider === "aeroapi" || provider === "aerodatabox" ? "some-key" : null
    );
    respondWith(fixture.flights);

    const result = await lookupFlightDetails("LH400", "2026-10-05");

    expect(result?.source).toBe("aeroapi");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get.mock.calls[0][0]).toContain("aeroapi.flightaware.com");
  });

  it("falls through to the existing order when AeroAPI has nothing", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider: string) =>
      provider === "aeroapi" || provider === "aerodatabox" ? "some-key" : null
    );
    respondWith([]);
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          number: "LH 400",
          codeshareStatus: "isOperator",
          airline: { name: "Lufthansa" },
          departure: {
            airport: { iata: "FRA" },
            scheduledTime: { utc: "2026-10-05 11:55Z", local: "2026-10-05 13:55+02:00" },
          },
          arrival: { airport: { iata: "JFK" }, scheduledTime: { utc: "2026-10-05 20:45Z" } },
        },
      ],
    });

    const result = await lookupFlightDetails("LH400", "2026-10-05");

    expect(result?.source).toBe("aerodatabox");
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });
});

describe("testAeroapiKey", () => {
  beforeEach(() => {
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown): boolean =>
        typeof error === "object" &&
        error !== null &&
        (error as { isAxiosError?: unknown }).isAxiosError === true
    );
  });

  it("asks /airports/EDDF with x-apikey and reports 200 as valid", async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: { airport_code: "EDDF" } });

    const result = await testAeroapiKey("aeroapi-secret");

    expect(result).toMatchObject({ success: true, messageKey: "valid" });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://aeroapi.flightaware.com/aeroapi/airports/EDDF",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-apikey": "aeroapi-secret" }),
      })
    );
  });

  it("reports 401 as an invalid key", async () => {
    mockedAxios.get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 } });

    const result = await testAeroapiKey("bad");

    expect(result).toMatchObject({ success: false, messageKey: "invalid" });
  });

  it("reports 429 as rate limited", async () => {
    mockedAxios.get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 429 } });

    const result = await testAeroapiKey("busy");

    expect(result).toMatchObject({ success: false, messageKey: "rateLimited" });
  });
});
