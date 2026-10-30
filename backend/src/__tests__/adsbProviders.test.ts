/**
 * adsb.lol + ADS-B Exchange (forgejo#408): the readsb-v2 adapter and its place
 * in the lookup chain. No real network — axios is mocked.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../services/airportLookup", () => ({
  findOrCreateAirport: jest.fn(async (code: string) => ({
    iata: code,
    icao: `I${code}`,
    name: `${code} Intl`,
    lat: 1,
    lon: 2,
  })),
  enrichAirportMetadata: jest.fn(async () => false),
}));

const keys: Record<string, string | null> = {};
const apiKeyResolverMock = {
  getApiKey: jest.fn(async (provider: string) => keys[provider] ?? null),
  resolveApiKey: jest.fn(async (provider: string) => {
    const key = keys[provider] ?? null;
    return { key, source: key ? ("env" as const) : null };
  }),
  getOpenSkyCredentials: jest.fn(async () => null as Record<string, string> | null),
};
jest.mock("../services/apiKeyResolver", () => apiKeyResolverMock);

const adminRow = { adsbLolEnabled: false };
jest.mock("../db", () => ({
  prisma: { adminSettings: { findFirst: jest.fn(async () => adminRow) } },
}));

jest.mock("../utils/timezone", () => ({
  ...(jest.requireActual("../utils/timezone") as object),
  getAirportTimezone: jest.fn(async () => null),
  convertAviationstackTimeToUtc: jest.fn(async (t: string) => t),
  convertAirlabsTimeToUtc: jest.fn(async (t: string) => t),
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  lookupAdsbV2,
  mapReadsbAircraft,
  resolveAdsbEndpoints,
  __resetAdsbForTests,
  __setAdsbMinIntervalForTests,
  type AdsbEndpoint,
} from "../services/flightLookup/adsbV2";
import { toIcaoCallsign } from "../services/flightLookup/adsbChain";
import { lookupFlightDetails, __resetAviationstackBudgetForTests } from "../services/flightLookup";
import { LookupOutcomeLog } from "../services/flightLookup/providerOutcome";
import { flightProviderAvailability } from "../services/flightLookup/providerAvailability";

const LOL: AdsbEndpoint = { provider: "adsblol", baseUrl: "https://api.adsb.lol/v2", headers: {} };

const plane = {
  hex: "3c6518",
  flight: "DLH400  ",
  r: "d-aihx",
  t: "a359",
  lat: 50.1,
  lon: 8.6,
  alt_baro: 31000,
  gs: 450.5,
  track: 270,
  seen: 2.1,
};

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });

beforeEach(() => {
  mockedAxios.get.mockReset();
  __resetAdsbForTests();
  __setAdsbMinIntervalForTests(0);
  __resetAviationstackBudgetForTests();
  for (const k of Object.keys(keys)) delete keys[k];
  adminRow.adsbLolEnabled = false;
});

describe("readsb v2 mapping", () => {
  it("maps registration, type, hex, callsign and the last position", () => {
    expect(mapReadsbAircraft(plane)).toEqual({
      icao24: "3C6518",
      callsign: "DLH400",
      registration: "D-AIHX",
      aircraftType: "A359",
      position: {
        lat: 50.1,
        lon: 8.6,
        altitudeFt: 31000,
        onGround: false,
        groundSpeedKt: 450.5,
        trackDeg: 270,
        seenSeconds: 2.1,
      },
    });
  });

  it("reads alt_baro 'ground' as on the ground, not as an altitude", () => {
    const m = mapReadsbAircraft({ ...plane, alt_baro: "ground" });
    expect(m.position.onGround).toBe(true);
    expect(m.position.altitudeFt).toBeNull();
  });

  it("leaves absent fields null instead of zero", () => {
    const m = mapReadsbAircraft({ hex: "abc123" });
    expect(m.registration).toBeNull();
    expect(m.position.groundSpeedKt).toBeNull();
    expect(m.position.lat).toBeNull();
  });
});

describe("lookupAdsbV2 — every failure has its own reason", () => {
  it("returns the freshest aircraft for a callsign and asks the v2 path", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        ac: [
          { ...plane, seen: 40 },
          { ...plane, r: "d-aixx", seen: 1 },
        ],
      },
    });
    const result = await lookupAdsbV2(LOL, { kind: "callsign", value: "DLH400" });
    expect(result).toMatchObject({ status: "ok", provider: "adsblol" });
    expect(result.status === "ok" && result.aircraft.registration).toBe("D-AIXX");
    expect(mockedAxios.get.mock.calls[0][0]).toBe("https://api.adsb.lol/v2/callsign/DLH400");
  });

  it("an empty ac list is no_match", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { ac: [] } });
    expect(await lookupAdsbV2(LOL, { kind: "hex", value: "3C6518" })).toEqual({
      status: "no_match",
      provider: "adsblol",
    });
  });

  it("an aircraft not heard for minutes is not 'in the air now'", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { ac: [{ ...plane, seen: 900 }] } });
    expect((await lookupAdsbV2(LOL, { kind: "reg", value: "D-AIHX" })).status).toBe("no_match");
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "quota"],
    [500, "provider_error"],
  ])("HTTP %i is failed/%s, not an empty answer", async (status, reason) => {
    mockedAxios.get.mockRejectedValueOnce(httpError(status));
    expect(await lookupAdsbV2(LOL, { kind: "callsign", value: `X${status}` })).toEqual({
      status: "failed",
      provider: "adsblol",
      reason,
    });
  });

  it("a timeout is failed/timeout", async () => {
    mockedAxios.get.mockRejectedValueOnce(Object.assign(new Error("t"), { code: "ECONNABORTED" }));
    expect(await lookupAdsbV2(LOL, { kind: "callsign", value: "TMO1" })).toMatchObject({
      status: "failed",
      reason: "timeout",
    });
  });

  it("a network error is failed/provider_error", async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await lookupAdsbV2(LOL, { kind: "callsign", value: "NET1" })).toMatchObject({
      status: "failed",
      reason: "provider_error",
    });
  });

  it("a body that is not readsb v2 is a failure, not a quiet no_match", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: "<html>maintenance</html>" });
    expect(await lookupAdsbV2(LOL, { kind: "callsign", value: "BAD1" })).toMatchObject({
      status: "failed",
      reason: "provider_error",
    });
  });

  it("caches an answer for 60 s but never a failure", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { ac: [plane] } });
    await lookupAdsbV2(LOL, { kind: "callsign", value: "DLH400" });
    await lookupAdsbV2(LOL, { kind: "callsign", value: "DLH400" });
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    mockedAxios.get.mockRejectedValueOnce(httpError(429));
    mockedAxios.get.mockResolvedValueOnce({ data: { ac: [plane] } });
    expect((await lookupAdsbV2(LOL, { kind: "callsign", value: "RETRY1" })).status).toBe("failed");
    expect((await lookupAdsbV2(LOL, { kind: "callsign", value: "RETRY1" })).status).toBe("ok");
  });
});

describe("opt-in — off unless configured", () => {
  it("nothing is enabled without an ADSBx key, an adsb.lol key or the admin switch", async () => {
    expect(await resolveAdsbEndpoints()).toEqual([]);
  });

  it("an ADSBx key enables ADS-B Exchange with the RapidAPI headers, listed before adsb.lol", async () => {
    keys.adsbx = "rapid-key";
    adminRow.adsbLolEnabled = true;
    const endpoints = await resolveAdsbEndpoints("u1");
    expect(endpoints.map((e) => e.provider)).toEqual(["adsbx", "adsblol"]);
    expect(endpoints[0].headers).toEqual({
      "X-RapidAPI-Key": "rapid-key",
      "X-RapidAPI-Host": "adsbexchange-com1.p.rapidapi.com",
    });
  });

  it("the admin switch enables adsb.lol keyless", async () => {
    adminRow.adsbLolEnabled = true;
    const [lol] = await resolveAdsbEndpoints();
    expect(lol).toMatchObject({ provider: "adsblol", headers: {} });
  });

  it("an adsb.lol key counts as enabled and is sent on every request", async () => {
    keys.adsblol = "lol-key";
    const [lol] = await resolveAdsbEndpoints();
    expect(lol).toMatchObject({ provider: "adsblol", headers: { "api-auth": "lol-key" } });
  });

  it("an enabled ADS-B provider counts as configured, but never as answering by date", async () => {
    keys.adsbx = "rapid-key";
    keys.adsblol = "lol-key";
    expect(await flightProviderAvailability()).toEqual({ any: true, byDate: false });
  });

  it("an entry that names no aircraft is a no_match, not a successful empty aircraft", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { ac: [{}] } });
    expect((await lookupAdsbV2(LOL, { kind: "callsign", value: "EMPTY1" })).status).toBe(
      "no_match"
    );
  });
});

describe("callsign", () => {
  it("turns an IATA flight number into the ICAO callsign a transponder sends", () => {
    expect(toIcaoCallsign("LH400")).toBe("DLH400");
    expect(toIcaoCallsign("DLH400")).toBe("DLH400");
    expect(toIcaoCallsign("not a flight")).toBeNull();
  });
});

describe("chain: lookupFlightDetails", () => {
  const today = new Date().toISOString().slice(0, 10);
  const airlabsRoute = (aircraft_icao?: string) => ({
    data: {
      response: [
        {
          flight_iata: "LH400",
          airline_iata: "LH",
          dep_iata: "FRA",
          arr_iata: "JFK",
          dep_time_utc: `${today} 10:00`,
          arr_time_utc: `${today} 18:00`,
          aircraft_icao,
        },
      ],
    },
  });

  /** Routes axios by host so a test states what each provider answers. */
  const serve = (answers: { airlabs?: unknown; adsbx?: unknown; adsblol?: unknown }) =>
    mockedAxios.get.mockImplementation(async (url: string) => {
      const key = url.includes("airlabs")
        ? "airlabs"
        : url.includes("rapidapi")
          ? "adsbx"
          : "adsblol";
      const answer = answers[key];
      if (answer instanceof Error) throw answer;
      return answer ?? { data: { response: [], ac: [] } };
    });

  const adsbCalls = () =>
    mockedAxios.get.mock.calls
      .filter(([u]) => !String(u).includes("airlabs"))
      .map(([u]) => String(u));

  it("fills the registration after AirLabs when enabled, and never overwrites AirLabs' type", async () => {
    keys.airlabs = "al";
    adminRow.adsbLolEnabled = true;
    serve({ airlabs: airlabsRoute("A359"), adsblol: { data: { ac: [{ ...plane, t: "A35K" }] } } });

    const result = await lookupFlightDetails("LH400", today);

    expect(result?.source).toBe("airlabs");
    expect(result?.aircraftRegistration).toBe("D-AIHX");
    expect(result?.aircraft).toBe("A359");
    expect(adsbCalls()).toEqual(["https://api.adsb.lol/v2/callsign/DLH400"]);
  });

  it("asks ADS-B Exchange before adsb.lol", async () => {
    keys.airlabs = "al";
    keys.adsbx = "rapid";
    adminRow.adsbLolEnabled = true;
    serve({
      airlabs: airlabsRoute(),
      adsbx: { data: { ac: [] } },
      adsblol: { data: { ac: [plane] } },
    });
    const outcomes = new LookupOutcomeLog();

    const result = await lookupFlightDetails(
      "LH401",
      today,
      undefined,
      undefined,
      undefined,
      undefined,
      outcomes
    );

    expect(adsbCalls().map((u) => (u.includes("rapidapi") ? "adsbx" : "adsblol"))).toEqual([
      "adsbx",
      "adsblol",
    ]);
    expect(result?.aircraftRegistration).toBe("D-AIHX");
    expect(outcomes.all().filter((o) => o.provider.startsWith("adsb"))).toEqual([
      { provider: "adsbx", outcome: "no_match" },
      { provider: "adsblol", outcome: "ok" },
    ]);
  });

  it("makes no request at all while neither provider is enabled", async () => {
    keys.airlabs = "al";
    serve({ airlabs: airlabsRoute() });
    const result = await lookupFlightDetails("LH402", today);
    expect(result?.aircraftRegistration).toBeUndefined();
    expect(adsbCalls()).toEqual([]);
  });

  it("never calls them for a date other than today", async () => {
    keys.airlabs = "al";
    keys.adsbx = "rapid";
    adminRow.adsbLolEnabled = true;
    serve({ airlabs: airlabsRoute() });
    await lookupFlightDetails("LH403", "2020-01-02");
    expect(adsbCalls()).toEqual([]);
  });

  it("a failing provider is recorded under its own reason and the lookup still answers", async () => {
    keys.airlabs = "al";
    adminRow.adsbLolEnabled = true;
    serve({ airlabs: airlabsRoute(), adsblol: httpError(429) });
    const outcomes = new LookupOutcomeLog();

    const result = await lookupFlightDetails(
      "LH404",
      today,
      undefined,
      undefined,
      undefined,
      undefined,
      outcomes
    );

    expect(result?.source).toBe("airlabs");
    expect(outcomes.failures()).toEqual([{ provider: "adsblol", outcome: "quota" }]);
  });

  it("when AirLabs finds nothing, ADS-B alone answers with the aircraft (no route)", async () => {
    keys.airlabs = "al";
    adminRow.adsbLolEnabled = true;
    serve({ adsblol: { data: { ac: [plane] } } });

    const result = await lookupFlightDetails("LH405", today);

    expect(result).toMatchObject({
      source: "adsblol",
      aircraftRegistration: "D-AIHX",
      aircraft: "A359",
    });
    expect(result?.departure).toBeUndefined();
  });
});

describe("wrapper: an ADS-B answer is never today's aircraft for another day", () => {
  it("lookupFlightWithHistorical reports no_match_api_gap for a non-live day", async () => {
    const { lookupFlightWithHistorical } = await import("../services/flightLookup");
    keys.adsblol = "lol-key";
    // Local 'tomorrow' that happens to be the UTC day of the ADS-B request.
    mockedAxios.get.mockImplementation(async (url: string) =>
      url.includes("adsb.lol") ? { data: { ac: [plane] } } : { data: { response: [] } }
    );
    keys.aviationstack = "av"; // something that answers by date, so the wrapper reaches the cascade
    // A zone where the UTC day of "now" is the user's tomorrow (or yesterday).
    const clientTimezone =
      new Date().getUTCHours() >= 10 ? "Pacific/Kiritimati" : "Pacific/Pago_Pago";
    const out = await lookupFlightWithHistorical("LH499", new Date(), undefined, undefined, {
      clientTimezone,
    });
    expect(out.flights).toEqual([]);
    expect(out.unavailableReason).toBe("no_match_api_gap");
  });
});
