/**
 * The AeroAPI track sweep (forgejo#409): a FlightAware track is stored once,
 * after arrival, inside AeroAPI's window, only for a flight with no recording
 * of its own, and only when the admin switched it on. Real database, axios
 * mocked (the fixture is docs-derived; no real API is ever called).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from "@jest/globals";
import axios from "axios";

import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { ensureAdminSettingsRow } from "../services/adminSettingsRow";
import { __resetAeroapiRateForTests } from "../services/aeroapiBudget";
import {
  __resetTrackSweepForTests,
  AEROAPI_TRACK_MAX_ATTEMPTS,
  positionsToPoints,
  storeAeroapiTrack,
  sweepAeroapiTracks,
} from "../services/aeroapiTrack";
import { flightTrackColumns } from "../services/flightDevice/flightTrackIngest";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../services/apiKeyResolver", () => ({
  ...(jest.requireActual("../services/apiKeyResolver") as object),
  getApiKey: jest.fn(async () => "aeroapi-secret"),
}));

const NOW = new Date("2026-10-05T20:00:00Z");
const DEPARTURE = Date.parse("2026-10-05T08:00:00Z");
const HOUR = 3_600_000;

/** Due east along 50°N, a point a minute, 0.2° (~14 km) per step. */
const positions = Array.from({ length: 40 }, (_, i) => ({
  timestamp: new Date(DEPARTURE + 5 * 60_000 + i * 60_000).toISOString(),
  latitude: 50,
  longitude: 8 + i * 0.2,
  altitude: 350,
  groundspeed: 450,
}));

const instance = (over: object = {}) => ({
  ident_iata: "LH718",
  fa_flight_id: "DLH718-1760000000-fa-1",
  scheduled_out: new Date(DEPARTURE).toISOString(),
  actual_in: new Date(DEPARTURE + 11 * HOUR).toISOString(),
  origin: { code_iata: "MUC" },
  ...over,
});

/** AeroAPI as the sweep sees it: the flight list for a number, the track for an id. */
function serve(options: { flights?: object[]; track?: object | Error } = {}) {
  mockedAxios.get.mockImplementation(async (url: string) => {
    if (url.endsWith("/track")) {
      if (options.track instanceof Error) throw options.track;
      return { data: options.track ?? { positions } };
    }
    return { data: { flights: options.flights ?? [instance()] } };
  });
}
const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const trackCalls = () =>
  mockedAxios.get.mock.calls.filter(([url]) => String(url).endsWith("/track")).length;

describe("AeroAPI track sweep", () => {
  let userId: string;
  let savedSettings: {
    aeroapiTier: string;
    aeroapiCustomBudgetUsd: number | null;
    aeroapiTracksEnabled: boolean;
  };

  async function makeFlight(over: Record<string, unknown> = {}) {
    return prisma.flight.create({
      data: {
        userId,
        depIata: "MUC",
        arrIata: "ICN",
        depLat: 48.354,
        depLon: 11.786,
        arrLat: 37.469,
        arrLon: 126.451,
        flightNumber: "LH718",
        departureTime: new Date(DEPARTURE),
        arrivalTime: new Date(DEPARTURE + 11 * HOUR),
        status: "flown",
        ...over,
      },
    });
  }
  const setSettings = async (data: object) =>
    prisma.adminSettings.update({ where: { id: await ensureAdminSettingsRow() }, data });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "aeroapitrack" } });
    userId = (
      await prisma.user.create({
        data: { username: "aeroapitrack", passwordHash: await hashPassword("password123") },
      })
    ).id;
    const row = await prisma.adminSettings.findUniqueOrThrow({
      where: { id: await ensureAdminSettingsRow() },
    });
    savedSettings = {
      aeroapiTier: row.aeroapiTier,
      aeroapiCustomBudgetUsd: row.aeroapiCustomBudgetUsd,
      aeroapiTracksEnabled: row.aeroapiTracksEnabled,
    };
  });

  beforeEach(async () => {
    mockedAxios.get.mockReset();
    __resetAeroapiRateForTests();
    __resetTrackSweepForTests();
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.aeroapiUsage.deleteMany();
    await setSettings({
      aeroapiTier: "custom",
      aeroapiCustomBudgetUsd: 100,
      aeroapiTracksEnabled: true,
    });
  });

  afterAll(async () => {
    await prisma.aeroapiUsage.deleteMany();
    await setSettings(savedSettings);
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("stores the FlightAware track once, as source aeroapi, and never asks for that flight again", async () => {
    const flight = await makeFlight();
    serve();

    const first = await sweepAeroapiTracks(NOW);

    expect(first.status).toBe("done");
    expect(first.counts).toEqual({ stored: 1 });
    const stored = await prisma.flightTrack.findUnique({ where: { flightId: flight.id } });
    expect(stored?.source).toBe("aeroapi");
    expect(stored?.uploadId).toBe("aeroapi:DLH718-1760000000-fa-1");
    expect(stored?.pointCount).toBe(40);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);

    mockedAxios.get.mockClear();
    const second = await sweepAeroapiTracks(NOW);

    expect(second.status).toBe("nothing_to_do");
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("does nothing, and says so, while the admin switch is off", async () => {
    await makeFlight();
    await setSettings({ aeroapiTracksEnabled: false });
    serve();

    const summary = await sweepAeroapiTracks(NOW);

    expect(summary.status).toBe("disabled");
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(await prisma.flightTrack.count({ where: { flight: { userId } } })).toBe(0);
  });

  it("leaves a flight alone that already has a device-recorded track", async () => {
    const flight = await makeFlight();
    const columns = flightTrackColumns(
      positionsToPoints(positions).map((p) => ({ ...p, lat: p.lat + 1 }))
    )!;
    await prisma.flightTrack.create({
      data: { ...columns, flightId: flight.id, source: "companion", uploadId: "phone-1" },
    });
    serve();

    const summary = await sweepAeroapiTracks(NOW);

    expect(summary.status).toBe("nothing_to_do");
    expect(mockedAxios.get).not.toHaveBeenCalled();
    const kept = await prisma.flightTrack.findUniqueOrThrow({ where: { flightId: flight.id } });
    expect(kept.source).toBe("companion");
    expect(kept.uploadId).toBe("phone-1");
  });

  it("never replaces a track that arrived between the check and the write", async () => {
    const flight = await makeFlight();
    const columns = flightTrackColumns(positionsToPoints(positions))!;
    await prisma.flightTrack.create({
      data: { ...columns, flightId: flight.id, source: "gpx", uploadId: "file:abc" },
    });

    expect(await storeAeroapiTrack(flight.id, "DLH718-x", columns)).toBe(false);

    const kept = await prisma.flightTrack.findUniqueOrThrow({ where: { flightId: flight.id } });
    expect(kept.source).toBe("gpx");
    expect(kept.uploadId).toBe("file:abc");
  });

  it("does not ask about a flight outside AeroAPI's 10-day window, before arrival, cancelled, or without real times", async () => {
    await makeFlight({
      departureTime: new Date(NOW.getTime() - 11 * 24 * HOUR),
      arrivalTime: new Date(NOW.getTime() - 11 * 24 * HOUR + 3 * HOUR),
    });
    await makeFlight({ arrivalTime: new Date(NOW.getTime() - 20 * 60_000) });
    await makeFlight({ status: "cancelled" });
    await makeFlight({ depTimeSemantics: "DATE_ONLY" });
    serve();

    const summary = await sweepAeroapiTracks(NOW);

    expect(summary.status).toBe("nothing_to_do");
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("sends no request once the monthly budget is reached and reports the budget as the reason", async () => {
    const flight = await makeFlight();
    await setSettings({ aeroapiCustomBudgetUsd: 0.005 }); // one status query, no track
    serve();

    const summary = await sweepAeroapiTracks(NOW);

    expect(summary.status).toBe("stopped_budget");
    expect(trackCalls()).toBe(0);
    expect(await prisma.flightTrack.count({ where: { flightId: flight.id } })).toBe(0);
    const attempt = await prisma.aeroapiTrackAttempt.findUniqueOrThrow({
      where: { flightId: flight.id },
    });
    expect(attempt.outcome).toBe("budget");
  });

  it("keeps the flight, tries again later and stops at a rejected key when AeroAPI fails", async () => {
    const flight = await makeFlight();
    serve({ track: httpError(500) });

    const failed = await sweepAeroapiTracks(NOW);

    expect(failed.counts).toEqual({ error: 1 });
    expect(await prisma.flightTrack.count({ where: { flightId: flight.id } })).toBe(0);
    // An HTTP error answer was not billed: only the status query is on the books.
    expect((await prisma.aeroapiUsage.findFirstOrThrow()).spentMilliUsd).toBe(5);

    // Transient: asked again, then given up after the cap.
    for (let i = 1; i < AEROAPI_TRACK_MAX_ATTEMPTS; i++) await sweepAeroapiTracks(NOW);
    mockedAxios.get.mockClear();
    expect((await sweepAeroapiTracks(NOW)).status).toBe("nothing_to_do");
    expect(mockedAxios.get).not.toHaveBeenCalled();

    // A rejected key stops the sweep instead of burning through every flight.
    await prisma.aeroapiTrackAttempt.deleteMany();
    mockedAxios.get.mockReset();
    mockedAxios.get.mockRejectedValue(httpError(401));
    await makeFlight({ flightNumber: "LH719" });
    const auth = await sweepAeroapiTracks(NOW);
    expect(auth.status).toBe("stopped_auth");
  });

  it("records no_match when FlightAware knows no such flight, and does not ask again", async () => {
    const flight = await makeFlight();
    serve({ flights: [] });

    expect((await sweepAeroapiTracks(NOW)).counts).toEqual({ no_match: 1 });
    expect(trackCalls()).toBe(0);
    expect(
      (await prisma.aeroapiTrackAttempt.findUniqueOrThrow({ where: { flightId: flight.id } }))
        .outcome
    ).toBe("no_match");
    mockedAxios.get.mockClear();
    expect((await sweepAeroapiTracks(NOW)).status).toBe("nothing_to_do");
  });

  describe("which flight, which queue", () => {
    it("never stores another airport pair's line against the flight (a neighbouring rotation)", async () => {
      const flight = await makeFlight();
      serve({
        flights: [
          instance({ origin: { code_iata: "MUC" }, destination: { code_iata: "FRA" } }),
          instance({ origin: { code_iata: "FRA" }, destination: { code_iata: "MUC" } }),
        ],
      });

      const summary = await sweepAeroapiTracks(NOW);

      expect(summary.counts).toEqual({ no_match: 1 });
      expect(trackCalls()).toBe(0);
      expect(await prisma.flightTrack.count({ where: { flightId: flight.id } })).toBe(0);
    });

    it("does not use up a flight's retries on a budget refusal, so it is fetched once the budget allows", async () => {
      const flight = await makeFlight();
      await setSettings({ aeroapiCustomBudgetUsd: 0.001 });
      serve();
      for (let i = 0; i < AEROAPI_TRACK_MAX_ATTEMPTS + 1; i++) {
        expect((await sweepAeroapiTracks(NOW)).status).toBe("stopped_budget");
      }

      await setSettings({ aeroapiCustomBudgetUsd: 100 });
      const summary = await sweepAeroapiTracks(NOW);

      expect(summary.counts).toEqual({ stored: 1 });
      expect(await prisma.flightTrack.count({ where: { flightId: flight.id } })).toBe(1);
    });

    it("is not starved by flights that can never qualify", async () => {
      // Older arrivals sort first; sixty of them have a placeholder clock.
      for (let i = 0; i < 60; i++) {
        await makeFlight({
          flightNumber: `LH${800 + i}`,
          depTimeSemantics: "DATE_ONLY",
          departureTime: new Date(DEPARTURE - 3 * HOUR),
          arrivalTime: new Date(DEPARTURE + 8 * HOUR),
        });
      }
      const eligible = await makeFlight();
      serve();

      const summary = await sweepAeroapiTracks(NOW);

      expect(summary.counts).toEqual({ stored: 1 });
      expect(await prisma.flightTrack.count({ where: { flightId: eligible.id } })).toBe(1);
    });
  });
});

describe("positionsToPoints", () => {
  it("converts hundreds of feet to metres and knots to m/s, drops unusable fixes, orders by time", () => {
    const points = positionsToPoints([
      {
        timestamp: "2026-10-05T08:02:00Z",
        latitude: 50,
        longitude: 9,
        altitude: 350,
        groundspeed: 450,
      },
      { timestamp: "2026-10-05T08:01:00Z", latitude: 50, longitude: 8 },
      { timestamp: "not a time", latitude: 50, longitude: 8 },
      { timestamp: "2026-10-05T08:03:00Z", latitude: null, longitude: 8 },
      { timestamp: "2026-10-05T08:04:00Z", latitude: 95, longitude: 8 },
    ]);

    expect(points).toHaveLength(2);
    expect(points[0].lon).toBe(8);
    expect(points[0].alt).toBeUndefined();
    expect(points[1].alt).toBeCloseTo(10_668, 0);
    expect(points[1].speed).toBeCloseTo(231.5, 0);
  });
});
