/**
 * Silent-failure review 2026-09-26.
 *
 *  - Finding 6: every adapter turned a refused key, a spent quota or a timeout
 *    into `[]` / `null`, and the UI lookup answered "No flights found". The
 *    cascade now reports `provider_failed` with the provider and the reason.
 *  - Finding 1 (server half): a hit carries each airport's zone and wall
 *    clock, so the form no longer reads a UTC instant as local time.
 *  - "Today" was the UTC day: at 00:30 in Germany a search for today was a
 *    search for tomorrow, refused as needing a paid provider.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../services/airportLookup", () => ({
  findOrCreateAirport: jest.fn(async (code: string) => ({
    iata: code,
    icao: null,
    name: `${code} Airport`,
    lat: 0,
    lon: 0,
  })),
  enrichAirportMetadata: jest.fn(async () => undefined),
}));

const apiKeyResolverMock = {
  getApiKey: jest.fn(async (_provider: string, _userId?: string) => null as string | null),
  getOpenSkyCredentials: jest.fn(async () => null),
};
jest.mock("../services/apiKeyResolver", () => apiKeyResolverMock);

const ZONES: Record<string, string> = {
  FRA: "Europe/Berlin",
  JFK: "America/New_York",
};
jest.mock("../utils/timezone", () => ({
  ...(jest.requireActual("../utils/timezone") as object),
  getAirportTimezone: jest.fn(async (code?: string | null) =>
    code ? (ZONES[code] ?? null) : null
  ),
  convertAirlabsTimeToUtc: jest.fn(async (t: string) => t),
  convertAviationstackTimeToUtc: jest.fn(async (t: string) => t),
}));

jest.mock("../services/apiQuota", () => ({ recordObservedQuota: jest.fn() }));

jest.mock("../db", () => ({
  prisma: {
    adminSettings: { findFirst: jest.fn(async () => null) },
  },
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  lookupFlightWithHistorical,
  __resetAviationstackBudgetForTests,
} from "../services/flightLookup";
import { __resetAerodataboxCacheForTests } from "../services/aerodataboxLookup";

const onlyKey =
  (...providers: string[]) =>
  async (provider: string): Promise<string | null> =>
    providers.includes(provider) ? `${provider}-key` : null;

const airlabsHit = {
  data: {
    response: [
      {
        airline_name: "Lufthansa",
        airline_iata: "LH",
        dep_iata: "FRA",
        dep_time_utc: "2026-09-26T11:25:00.000Z",
        arr_iata: "JFK",
        arr_time_utc: "2026-09-26T20:10:00.000Z",
      },
    ],
  },
};

let flightSeq = 0;
/** A fresh number per test: the AirLabs cache is module-wide. */
const nextNumber = (): string => `LH${400 + ++flightSeq}`;

describe("lookupFlightWithHistorical — a failing provider is not 'no flight'", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetAviationstackBudgetForTests();
    __resetAerodataboxCacheForTests();
    apiKeyResolverMock.getOpenSkyCredentials.mockResolvedValue(null);
  });

  it("reports an AirLabs key refused in a 200 body as provider_failed/auth, and does not cache it", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(onlyKey("airlabs"));
    const number = nextNumber();
    mockedAxios.get.mockResolvedValueOnce({
      data: { error: { code: "unknown_api_key", message: "Unknown api_key" } },
    });

    const refused = await lookupFlightWithHistorical(number, undefined);
    expect(refused.unavailableReason).toBe("provider_failed");
    expect(refused.providerFailures).toEqual([{ provider: "airlabs", outcome: "auth" }]);

    // Key fixed: the next search reaches the provider instead of a cached "none".
    mockedAxios.get.mockResolvedValueOnce(airlabsHit);
    const fixed = await lookupFlightWithHistorical(number, undefined);
    expect(fixed.flights).toHaveLength(1);
  });

  it.each([
    ["quota", Object.assign(new Error("429"), { response: { status: 429 } })],
    ["timeout", Object.assign(new Error("timeout of 5000ms exceeded"), { code: "ECONNABORTED" })],
    ["auth", Object.assign(new Error("401"), { response: { status: 401 } })],
    ["provider_error", Object.assign(new Error("500"), { response: { status: 500 } })],
  ])("reports a thrown AirLabs %s as such", async (outcome, error) => {
    apiKeyResolverMock.getApiKey.mockImplementation(onlyKey("airlabs"));
    mockedAxios.get.mockRejectedValueOnce(error);

    const result = await lookupFlightWithHistorical(nextNumber(), undefined);
    expect(result.unavailableReason).toBe("provider_failed");
    expect(result.providerFailures).toEqual([{ provider: "airlabs", outcome }]);
  });

  it("reports a refused AeroDataBox key for a past date", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(onlyKey("aerodatabox"));
    mockedAxios.get.mockRejectedValueOnce(
      Object.assign(new Error("403"), { response: { status: 403, headers: {} } })
    );

    const past = new Date(Date.now() - 40 * 86_400_000);
    const result = await lookupFlightWithHistorical(nextNumber(), past);
    expect(result.unavailableReason).toBe("provider_failed");
    expect(result.providerFailures).toEqual([{ provider: "aerodatabox", outcome: "auth" }]);
  });

  it("still says 'not found' when every provider answered and none knew it", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(onlyKey("airlabs"));
    mockedAxios.get.mockResolvedValueOnce({ data: { response: [] } });

    const result = await lookupFlightWithHistorical(nextNumber(), undefined);
    expect(result.unavailableReason).toBeUndefined();
    expect(result.providerFailures).toBeUndefined();
    expect(result.flights).toEqual([]);
  });
});

describe("lookupFlightWithHistorical — each airport's clock rides along", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetAviationstackBudgetForTests();
    apiKeyResolverMock.getApiKey.mockImplementation(onlyKey("airlabs"));
  });

  it("gives LH400's 11:25 UTC departure as 13:25 in Frankfurt", async () => {
    mockedAxios.get.mockResolvedValueOnce(airlabsHit);
    const { flights } = await lookupFlightWithHistorical(nextNumber(), undefined);

    expect(flights[0].departure).toMatchObject({
      scheduledTime: "2026-09-26T11:25:00.000Z",
      timezone: "Europe/Berlin",
      scheduledLocal: "2026-09-26T13:25",
    });
    expect(flights[0].arrival).toMatchObject({
      timezone: "America/New_York",
      scheduledLocal: "2026-09-26T16:10",
    });
  });
});

describe("lookupFlightWithHistorical — 'today' is the asker's day, not UTC's", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetAviationstackBudgetForTests();
    apiKeyResolverMock.getApiKey.mockImplementation(onlyKey("airlabs"));
    // 00:30 on the 26th in Germany is 22:30 on the 25th in UTC.
    jest.useFakeTimers({ now: new Date("2026-09-25T22:30:00Z"), doNotFake: ["nextTick"] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("searches today's live window for a Berlin user at 00:30", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { response: [] } });
    const result = await lookupFlightWithHistorical(
      nextNumber(),
      new Date("2026-09-26"),
      undefined,
      undefined,
      { clientTimezone: "Europe/Berlin" }
    );
    expect(result.unavailableReason).not.toBe("no_provider");
    expect(mockedAxios.get).toHaveBeenCalled();
  });

  it("ignores a zone the runtime does not know (UTC stays the fallback)", async () => {
    const result = await lookupFlightWithHistorical(
      nextNumber(),
      new Date("2026-09-26"),
      undefined,
      undefined,
      { clientTimezone: "Mars/Olympus" }
    );
    expect(result.unavailableReason).toBe("no_provider");
  });
});
