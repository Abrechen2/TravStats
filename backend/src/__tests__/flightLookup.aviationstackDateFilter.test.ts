/**
 * Aviationstack Free-tier date-filter handling + provider source attribution.
 *
 * The Free plan rejects the `flight_date` query param with
 * 403 `function_access_restricted` (prod audit 2026-06-07: every tracker
 * lookup burned a budget call on a guaranteed 403 and silently fell back to
 * AirLabs). `lookupFlightDetails` must:
 *   1. learn the restriction from the first 403 and retry a same-day lookup
 *      without `flight_date` (real-time queries are allowed on Free),
 *   2. skip Aviationstack entirely for non-today dates once the restriction
 *      is known (no budget burn on guaranteed failures),
 *   3. guard date-less responses against date mismatches (a date-less query
 *      returns "latest known flight", which may belong to another day),
 *   4. label every result with the provider that actually served it
 *      (`source`), so pending updates stop claiming "aviationstack" for
 *      data that came from the AirLabs fallback.
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
  getApiKey: jest.fn(async (provider: string) => {
    if (provider === "aviationstack") return "test-avs-key";
    if (provider === "airlabs") return "test-airlabs-key";
    return null;
  }),
  getOpenSkyCredentials: jest.fn(async () => null),
}));

// AeroDataBox would otherwise fire for every dated lookup.
jest.mock("../services/aerodataboxLookup", () => ({
  lookupFlightAerodatabox: jest.fn(async () => null),
}));

jest.mock("../utils/timezone", () => ({
  convertAviationstackTimeToUtc: jest.fn(async (t: string) => t),
  convertAirlabsTimeToUtc: jest.fn(async (t: string) => t),
}));

jest.mock("../db", () => ({
  prisma: {
    adminSettings: {
      findFirst: jest.fn(async () => ({ aviationstackDailyBudget: 10 })),
    },
    userSettings: { findUnique: jest.fn() },
  },
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────
import {
  lookupFlightDetails,
  __resetAviationstackBudgetForTests,
  __setAviationstackDateFilterRestrictedForTests,
} from "../services/flightLookup";

const AVS_URL = "https://api.aviationstack.com/v1/flights";
const AIRLABS_URL = "https://airlabs.co/api/v9/schedules";

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

type AxiosGetParams = { params?: Record<string, string> };

function avsCalls(): Array<[string, AxiosGetParams | undefined]> {
  return (
    mockedAxios.get.mock.calls as Array<[string, AxiosGetParams | undefined]>
  ).filter(([url]) => url === AVS_URL);
}

function aviationstackBody(flightDate: string) {
  return {
    data: {
      data: [
        {
          flight_date: flightDate,
          airline: { name: "Lufthansa" },
          flight: { iata: "LH123" },
          departure: { iata: "FRA", scheduled: `${flightDate}T10:00:00+00:00` },
          arrival: { iata: "MUC", scheduled: `${flightDate}T11:00:00+00:00` },
        },
      ],
    },
  };
}

function airlabsBody() {
  return {
    data: {
      response: [
        {
          flight_iata: "LH123",
          airline_iata: "LH",
          dep_iata: "FRA",
          dep_time_utc: `${today}T10:00:00.000Z`,
          arr_iata: "MUC",
          arr_time_utc: `${today}T11:00:00.000Z`,
        },
      ],
    },
  };
}

const restricted403 = {
  response: {
    status: 403,
    data: { error: { code: "function_access_restricted" } },
  },
};

describe("Aviationstack date-filter restriction handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetAviationstackBudgetForTests();
  });

  it("learns the restriction from a 403 and retries today's lookup without flight_date", async () => {
    mockedAxios.get
      .mockRejectedValueOnce(restricted403)
      .mockResolvedValueOnce(aviationstackBody(today));

    const result = await lookupFlightDetails("LH123", today);

    expect(result).not.toBeNull();
    expect(result?.source).toBe("aviationstack");

    const calls = avsCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0][1]?.params?.flight_date).toBe(today);
    expect(calls[1][1]?.params?.flight_date).toBeUndefined();
  });

  /**
   * The overnight case, and the owner's own objection: "surely the live
   * tracker must work for a +1 flight, since it tracks while you are in the
   * air".
   *
   * He is right, and the machinery was already here — the date-less
   * (real-time) query the free plan still allows, plus the
   * `aviationstack_date_mismatch` guard that discards an answer belonging to
   * another service day. Only the up-front gate stopped them being reached,
   * on the reasoning that "real-time queries only cover today". An aeroplane
   * that took off yesterday and has not landed is on the real-time feed this
   * minute, so that reasoning does not hold for the one case it mattered
   * most: LX93's two arrival checks both ran the day after departure, were
   * both refused, and the flight kept no actual times at all.
   */
  it("asks Aviationstack for a flight that is in the air, whatever day it left on", async () => {
    __setAviationstackDateFilterRestrictedForTests(true);
    mockedAxios.get.mockResolvedValueOnce(aviationstackBody(yesterday));

    // Departed 8h ago, lands in 2h — airborne right now.
    const departed = new Date(Date.now() - 8 * 3600 * 1000);
    const lands = new Date(Date.now() + 2 * 3600 * 1000);

    const result = await lookupFlightDetails("LH123", yesterday, undefined, departed, lands);

    expect(result).not.toBeNull();
    expect(result?.source).toBe("aviationstack");
    // Asked exactly once, and without the filter the plan rejects.
    const calls = avsCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]?.params?.flight_date).toBeUndefined();
  });

  it("still refuses a past date when the flight is NOT in the air", async () => {
    // The guard that keeps the exception from becoming a hole. A flight that
    // landed long ago is a historical question, and the free plan cannot
    // answer it — burning a call on it would be the waste this gate exists
    // to prevent.
    __setAviationstackDateFilterRestrictedForTests(true);
    mockedAxios.get.mockResolvedValue({ data: { response: [] } });

    const landedLongAgo = new Date(Date.now() - 40 * 3600 * 1000);
    const alsoLongAgo = new Date(Date.now() - 30 * 3600 * 1000);

    const result = await lookupFlightDetails(
      "LH123",
      "2026-05-01",
      undefined,
      landedLongAgo,
      alsoLongAgo,
    );

    expect(result).toBeNull();
    expect(avsCalls()).toHaveLength(0);
  });

  it("skips Aviationstack entirely for past dates once the restriction is known", async () => {
    __setAviationstackDateFilterRestrictedForTests(true);
    // AirLabs fallback returns nothing — we only care that Aviationstack
    // was never queried (and its budget never burned).
    mockedAxios.get.mockResolvedValue({ data: { response: [] } });

    const result = await lookupFlightDetails("LH123", "2026-05-01");

    expect(result).toBeNull();
    expect(avsCalls()).toHaveLength(0);
  });

  it("omits flight_date up-front for today's lookup once the restriction is known", async () => {
    __setAviationstackDateFilterRestrictedForTests(true);
    mockedAxios.get.mockResolvedValueOnce(aviationstackBody(today));

    const result = await lookupFlightDetails("LH123", today);

    expect(result?.source).toBe("aviationstack");
    const calls = avsCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]?.params?.flight_date).toBeUndefined();
  });

  it("discards a date-less response whose flight_date does not match the request", async () => {
    __setAviationstackDateFilterRestrictedForTests(true);
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url === AVS_URL) return aviationstackBody("2099-01-01"); // wrong day
      if (url === AIRLABS_URL) return airlabsBody();
      return { data: {} };
    });

    const result = await lookupFlightDetails("LH123", today);

    // Mismatched Aviationstack data must not be used — AirLabs serves instead.
    expect(result).not.toBeNull();
    expect(result?.source).toBe("airlabs");
  });

  it("labels the AirLabs fallback result with source 'airlabs'", async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url === AVS_URL) return { data: { data: [] } }; // no Aviationstack match
      if (url === AIRLABS_URL) return airlabsBody();
      return { data: {} };
    });

    const result = await lookupFlightDetails("LH123", today);

    expect(result).not.toBeNull();
    expect(result?.source).toBe("airlabs");
  });
});
