import request from "supertest";
import { jest } from "@jest/globals";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptApiKey } from "../../utils/encryption";
import logger from "../../utils/logger";

/**
 * Task 7 (Phase 3b tour tracks): pull a Dawarich time window into a track.
 *
 * Real app, real Postgres (trip/route/stop ownership + storage), only
 * `global.fetch` is faked — the SAME injection point `frankfurter.test.ts`
 * and `dawarichClient.test.ts` already use, so the real `createDawarichClient`
 * (task 6) and its real parsing/sorting run in these tests, not a stand-in.
 *
 * Fixtures are shaped exactly like Dawarich 1.9.2's real response (task-6
 * brief, restated in task-7's own brief): a BARE array, STRING lat/lon,
 * SECOND-precision timestamps, and NEWEST-FIRST ordering.
 */

const DAWARICH_BASE_URL = "https://dawarich.lan";
const DAWARICH_API_KEY = "sk-super-secret-dawarich-key";

const T_OLD = new Date("2026-06-01T08:00:00Z");
const T_MID = new Date("2026-06-01T08:05:00Z");
const T_NEW = new Date("2026-06-01T08:10:00Z");

function rawPoint(id: number, lat: number, lon: number, at: Date) {
  return {
    id,
    latitude: String(lat),
    longitude: String(lon),
    timestamp: Math.floor(at.getTime() / 1000),
    altitude: 500,
    accuracy: 5,
    velocity: "1.2",
    track_id: null,
  };
}

/** NEWEST FIRST, as Dawarich actually answers — see the client's own doc comment. */
const NEWEST_FIRST_POINTS = [
  rawPoint(3, 60.41, 5.34, T_NEW),
  rawPoint(2, 60.4, 5.33, T_MID),
  rawPoint(1, 60.39, 5.32, T_OLD),
];

function fakeOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe("Tour tracks — pull a Dawarich window", () => {
  const realFetch = global.fetch;

  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let tripId: string;
  let routeId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["tourtracksdawarich", "tourtracksdawarichother"] } },
    });

    const u = await prisma.user.create({
      data: { username: "tourtracksdawarich", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: {
        username: "tourtracksdawarichother",
        passwordHash: await hashPassword("password123"),
      },
    });
    otherCookie = `auth_token=${generateToken(other.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["tourtracksdawarich", "tourtracksdawarichother"] } },
    });
    await prisma.$disconnect();
    global.fetch = realFetch;
  });

  beforeEach(async () => {
    // Fresh trip + section + two dated stops per test, so each test's
    // section date span is known and cannot leak into another test.
    await prisma.trip.deleteMany({ where: { userId } });
    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen 2026" } });
    tripId = trip.id;

    const route = await prisma.tripRoute.create({
      data: { tripId, name: "Fjordrunde", mode: "road" },
    });
    routeId = route.id;

    await prisma.tripStop.create({
      data: {
        tripId,
        routeId,
        routeOrderIdx: 0,
        title: "Bergen",
        lat: 60.39,
        lon: 5.32,
        startDate: T_OLD,
        endDate: T_OLD,
      },
    });
    await prisma.tripStop.create({
      data: {
        tripId,
        routeId,
        routeOrderIdx: 1,
        title: "Voss",
        lat: 60.41,
        lon: 5.34,
        startDate: T_NEW,
        endDate: T_NEW,
      },
    });

    // No connection by default — each test that needs one seeds it itself.
    await prisma.userSettings.deleteMany({ where: { userId } });
    delete process.env.DAWARICH_BASE_URL;
    delete process.env.DAWARICH_API_KEY;

    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  async function seedUserConnection(): Promise<void> {
    await prisma.userSettings.upsert({
      where: { userId },
      update: { dawarichBaseUrl: DAWARICH_BASE_URL, dawarichApiKey: encryptApiKey(DAWARICH_API_KEY) },
      create: {
        userId,
        data: {},
        dawarichBaseUrl: DAWARICH_BASE_URL,
        dawarichApiKey: encryptApiKey(DAWARICH_API_KEY),
      },
    });
  }

  const pull = (body: Record<string, unknown> = {}) =>
    request(app)
      .post(`/api/v1/trips/${tripId}/routes/${routeId}/tracks/dawarich`)
      .set("Cookie", cookie)
      .send(body);

  it("pulls the section's own date span by default and stores a track with source dawarich", async () => {
    await seedUserConnection();
    (global.fetch as jest.Mock).mockResolvedValueOnce(fakeOkResponse(NEWEST_FIRST_POINTS));

    const res = await pull();

    expect(res.status).toBe(201);
    expect(res.body.track).toMatchObject({ routeId, source: "dawarich", pointCount: 3 });
    expect(res.body.track.distanceKm).toBeGreaterThan(0);

    // The default window came from the section's own dated stops (Bergen
    // T_OLD, Voss T_NEW) — assert the OUTGOING request actually asked for
    // that span, proving the "one click" default really ran.
    const calledUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("start_at")).toBe(T_OLD.toISOString());
    expect(calledUrl.searchParams.get("end_at")).toBe(T_NEW.toISOString());
  });

  it("stores the geometry in ascending time order although the fixture arrives newest-first", async () => {
    await seedUserConnection();
    (global.fetch as jest.Mock).mockResolvedValueOnce(fakeOkResponse(NEWEST_FIRST_POINTS));

    const res = await pull();

    expect(res.status).toBe(201);
    // Douglas-Peucker always keeps the first and last vertex of a
    // simplified line, so checking the two ends is robust regardless of
    // whether the middle point survives simplification.
    const geometry = res.body.track.geometry as Array<[number, number]>;
    expect(geometry[0]).toEqual([5.32, 60.39]); // oldest point (T_OLD)
    expect(geometry[geometry.length - 1]).toEqual([5.34, 60.41]); // newest point (T_NEW)
    expect(res.body.track.startedAt).toBe(T_OLD.toISOString());
    expect(res.body.track.endedAt).toBe(T_NEW.toISOString());
  });

  it("accepts an explicit override that replaces the derived window", async () => {
    await seedUserConnection();
    (global.fetch as jest.Mock).mockResolvedValueOnce(fakeOkResponse(NEWEST_FIRST_POINTS));

    const overrideStart = new Date("2026-06-01T00:00:00Z");
    const overrideEnd = new Date("2026-06-01T23:59:59Z");
    const res = await pull({
      startedAt: overrideStart.toISOString(),
      endedAt: overrideEnd.toISOString(),
    });

    expect(res.status).toBe(201);
    const calledUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("start_at")).toBe(overrideStart.toISOString());
    expect(calledUrl.searchParams.get("end_at")).toBe(overrideEnd.toISOString());
  });

  it("no connection configured → 409 with kind notConfigured", async () => {
    // beforeEach already wiped this user's settings and the env vars; the
    // admin-global tier is never written by any test in this file.
    const res = await pull();

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("notConfigured");

    expect((global.fetch as jest.Mock)).not.toHaveBeenCalled();
  });

  it("Dawarich unreachable → 409 with kind unreachable, and nothing is stored", async () => {
    await seedUserConnection();
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const before = await prisma.tripRouteTrack.count({ where: { routeId } });
    const res = await pull();
    const after = await prisma.tripRouteTrack.count({ where: { routeId } });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("unreachable");
    expect(after).toBe(before);
  });

  // MEDIUM-2 (final whole-phase review, 2026-08-29): before this fix, hitting
  // the client's hard page cap (`MAX_PAGES=50`) only logged a warning — the
  // stored track and its 201 response looked byte-identical to a complete
  // pull. `truncated` must now reach the stored row and the response.
  it("stores truncated=true and returns it in the response when the pull hits the hard page cap", async () => {
    await seedUserConnection();
    const fullPage = (offset: number) =>
      Array.from({ length: 1000 }, (_, i) => rawPoint(offset + i, 60.4, 5.33, T_MID));
    for (let page = 1; page <= 50; page += 1) {
      (global.fetch as jest.Mock).mockResolvedValueOnce(fakeOkResponse(fullPage(page * 1000)));
    }

    const res = await pull();

    expect(res.status).toBe(201);
    expect(res.body.track.truncated).toBe(true);

    const stored = await prisma.tripRouteTrack.findUnique({ where: { id: res.body.track.id } });
    expect(stored?.truncated).toBe(true);
  });

  it("stores truncated=false for a normal (non-capped) pull", async () => {
    await seedUserConnection();
    (global.fetch as jest.Mock).mockResolvedValueOnce(fakeOkResponse(NEWEST_FIRST_POINTS));

    const res = await pull();

    expect(res.status).toBe(201);
    expect(res.body.track.truncated).toBe(false);
  });

  // LOW-1 (final whole-phase review): the minimum point count used to live
  // only in `parseGpx`, so a Dawarich window with exactly one point stored a
  // one-coordinate "track" (pointCount: 1, distanceKm: 0) instead of being
  // refused the way an equivalent GPX file already is.
  it("refuses a window with exactly one point instead of storing a one-point track", async () => {
    await seedUserConnection();
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      fakeOkResponse([rawPoint(1, 60.39, 5.32, T_OLD)]),
    );

    const before = await prisma.tripRouteTrack.count({ where: { routeId } });
    const res = await pull();
    const after = await prisma.tripRouteTrack.count({ where: { routeId } });

    expect(res.status).toBe(409);
    expect(after).toBe(before);
  });

  it("an empty window (fetch succeeds, no points) → 409 with a message, not a zero-point track", async () => {
    await seedUserConnection();
    (global.fetch as jest.Mock).mockResolvedValueOnce(fakeOkResponse([]));

    const before = await prisma.tripRouteTrack.count({ where: { routeId } });
    const res = await pull();
    const after = await prisma.tripRouteTrack.count({ where: { routeId } });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no location data/i);
    expect(after).toBe(before);
  });

  it("never leaks the API key in the response body or a log line", async () => {
    await seedUserConnection();
    // Exercise both a success and a failure path — the key must appear in
    // neither, and the failure path is where the client's own warn log fires.
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(fakeOkResponse(NEWEST_FIRST_POINTS))
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const infoSpy = jest.spyOn(logger, "info");
    const warnSpy = jest.spyOn(logger, "warn");
    const errorSpy = jest.spyOn(logger, "error");

    const successRes = await pull();
    const failureRes = await pull();

    const allLogCalls = [...infoSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls];
    const loggedText = JSON.stringify(allLogCalls);
    const responseText = JSON.stringify(successRes.body) + JSON.stringify(failureRes.body);

    expect(responseText).not.toContain(DAWARICH_API_KEY);
    expect(loggedText).not.toContain(DAWARICH_API_KEY);

    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("404s another user's route rather than leaking its existence", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/routes/${routeId}/tracks/dawarich`)
      .set("Cookie", otherCookie)
      .send({});

    expect(res.status).toBe(404);
  });
});
