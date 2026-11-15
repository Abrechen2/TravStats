import request from "supertest";
import { jest } from "@jest/globals";
import axios from "axios";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { flightDeviceDataLimiter } from "../../middleware/rateLimit";
import { flightTrackColumns } from "../../services/flightDevice/flightTrackIngest";
import { updatePolicy } from "../../services/externalServices/policy";
import { DAY_START_S, cruiseRows, traceFile } from "../../services/tar1090/__tests__/traceFixtures";

/**
 * Past flight line from the user's OWN tar1090 receiver (forgejo#408 phase 3).
 * axios is spied: no network. Each failure must reach the caller as its own code.
 */
const DEPARTURE = Date.parse("2026-10-12T00:30:00Z");
const HEX = "3C6444";
// 00:30Z departure → fixes from 00:30 for 61 minutes.
const goodTrace = () => traceFile(cruiseRows(1800, 61));

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const codeError = (code: string) => Object.assign(new Error(code), { code });

describe("POST /flights/:id/track/receiver", () => {
  let cookie: string;
  let adminCookie: string;
  let userId: string;
  let adminId: string;
  let flightId: string;
  let adminFlightId: string;
  let getSpy: jest.SpiedFunction<typeof axios.get>;
  const urls: string[] = [];
  let respond: (url: string) => unknown | Promise<unknown>;

  const makeFlightFor = async (uid: string, hex: string | null = HEX) =>
    (
      await prisma.flight.create({
        data: {
          userId: uid,
          depIata: "FRA",
          arrIata: "MUC",
          depLat: 50,
          depLon: 8,
          arrLat: 48.3,
          arrLon: 11.7,
          flightNumber: "LH100",
          aircraftModeS: hex,
          departureTime: new Date(DEPARTURE),
          arrivalTime: new Date(DEPARTURE + 3_600_000),
          status: "flown",
        },
      })
    ).id;

  const post = (id = flightId, body: object = {}, c = cookie) =>
    request(app).post(`/api/v1/flights/${id}/track/receiver`).set("Cookie", c).send(body);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["rcvuser", "rcvadmin"] } } });
    const u = await prisma.user.create({
      data: { username: "rcvuser", passwordHash: await hashPassword("password123") },
    });
    const a = await prisma.user.create({
      data: {
        username: "rcvadmin",
        isAdmin: true,
        passwordHash: await hashPassword("password123"),
      },
    });
    userId = u.id;
    adminId = a.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    adminCookie = `auth_token=${generateToken(a.id)}`;
  });

  beforeEach(async () => {
    for (const uid of [userId, adminId]) {
      await flightDeviceDataLimiter.resetKey(`user:${uid}`);
      await prisma.flight.deleteMany({ where: { userId: uid } });
      await prisma.userSettings.upsert({
        where: { userId: uid },
        create: { userId: uid, data: {}, tar1090BaseUrl: null },
        update: { tar1090BaseUrl: null, externalServicePrefs: {} },
      });
    }
    await prisma.userSettings.update({
      where: { userId },
      data: { tar1090BaseUrl: "https://receiver.example.org" },
    });
    await prisma.adminSettings.updateMany({ data: { globalTar1090BaseUrl: null } });
    await updatePolicy((p) => ({ ...p, disabled: p.disabled.filter((x) => x !== "tar1090") }));
    flightId = await makeFlightFor(userId);
    adminFlightId = await makeFlightFor(adminId);
    urls.length = 0;
    respond = (url) =>
      url.includes("/globe_history/")
        ? { status: 200, data: goodTrace() }
        : { status: 404, data: "" };
    getSpy = jest.spyOn(axios, "get").mockImplementation((async (url: string) => {
      urls.push(url);
      const out = await respond(url);
      if (out instanceof Error) throw out;
      return out;
    }) as never);
  });

  afterEach(() => getSpy.mockRestore());

  afterAll(async () => {
    await prisma.adminSettings.updateMany({ data: { globalTar1090BaseUrl: null } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
    await prisma.$disconnect();
  });

  it("stores the receiver's leg as a readsb recording, asked by hex and day", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(res.body.track.source).toBe("readsb");
    expect(res.body.registration).toBe("D-AIXA");
    expect(urls[0]).toBe(
      "https://receiver.example.org/globe_history/2026/10/12/traces/44/trace_full_3c6444.json"
    );
    const stored = await prisma.flightTrack.findUniqueOrThrow({ where: { flightId } });
    expect(stored.source).toBe("readsb");
    expect(stored.pointCount).toBeGreaterThan(30);
  });

  it("falls back to the receiver's own trace file when globe history is not served", async () => {
    respond = (url) =>
      url.includes("/data/traces/") && url.includes("trace_full_")
        ? { status: 200, data: goodTrace() }
        : { status: 404, data: "" };
    expect((await post()).status).toBe(201);
    expect(urls).toHaveLength(2);
  });

  it("keeps the passenger's own recording unless replace is asked", async () => {
    const columns = flightTrackColumns(
      Array.from({ length: 10 }, (_, i) => ({
        t: DEPARTURE + i * 60_000,
        lat: 50,
        lon: 8 + i * 0.1,
      }))
    )!;
    await prisma.flightTrack.create({
      data: { ...columns, flightId, source: "companion", uploadId: "phone-1" },
    });
    const refused = await post();
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("TRACK_ALREADY_RECORDED");
    expect((await prisma.flightTrack.findUniqueOrThrow({ where: { flightId } })).source).toBe(
      "companion"
    );
    expect((await post(flightId, { replace: true })).status).toBe(200);
    expect((await prisma.flightTrack.findUniqueOrThrow({ where: { flightId } })).source).toBe(
      "readsb"
    );
  });

  it("replaces a server-fetched line without replace", async () => {
    const columns = flightTrackColumns(
      Array.from({ length: 10 }, (_, i) => ({
        t: DEPARTURE + i * 60_000,
        lat: 51,
        lon: 8 + i * 0.1,
      }))
    )!;
    await prisma.flightTrack.create({
      data: { ...columns, flightId, source: "aeroapi", uploadId: "aeroapi:x" },
    });
    expect((await post()).status).toBe(200);
  });

  it("answers 404 for another user's flight and fetches nothing", async () => {
    const res = await post(adminFlightId);
    expect(res.status).toBe(404);
    expect(urls).toHaveLength(0);
  });

  it("says why when the flight has no hex or no schedule, before any request", async () => {
    const noHex = await makeFlightFor(userId, null);
    expect((await post(noHex)).body.code).toBe("RECEIVER_NO_AIRCRAFT");
    const badHex = await makeFlightFor(userId, "not-hex");
    expect((await post(badHex)).body.code).toBe("RECEIVER_NO_AIRCRAFT");
    const noSchedule = await prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        arrIata: "MUC",
        depLat: 50,
        depLon: 8,
        arrLat: 48.3,
        arrLon: 11.7,
        aircraftModeS: HEX,
        status: "flown",
      },
    });
    expect((await post(noSchedule.id)).body.code).toBe("RECEIVER_NO_SCHEDULE");
    expect(urls).toHaveLength(0);
  });

  it("says not configured, and off when the admin switched the service off", async () => {
    await prisma.userSettings.update({ where: { userId }, data: { tar1090BaseUrl: null } });
    const none = await post();
    expect(none.status).toBe(409);
    expect(none.body.code).toBe("RECEIVER_NOT_CONFIGURED");
    await updatePolicy((p) => ({ ...p, disabled: [...p.disabled, "tar1090"] }));
    expect((await post()).body.code).toBe("RECEIVER_OFF");
    expect(urls).toHaveLength(0);
  });

  it("refuses a LAN receiver for an ordinary account, allows it for an admin", async () => {
    await prisma.userSettings.update({
      where: { userId },
      data: { tar1090BaseUrl: "http://192.168.1.50/tar1090" },
    });
    const refused = await post();
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("PRIVATE_TARGET");
    expect(urls).toHaveLength(0);

    await prisma.userSettings.update({
      where: { userId: adminId },
      data: { tar1090BaseUrl: "http://192.168.1.50/tar1090" },
    });
    const ok = await post(adminFlightId, {}, adminCookie);
    expect(ok.status).toBe(201);
    expect(urls[0]).toMatch(/^http:\/\/192\.168\.1\.50\/tar1090\/globe_history\//);
  });

  it("uses the instance receiver when the account has none", async () => {
    await prisma.userSettings.update({ where: { userId }, data: { tar1090BaseUrl: null } });
    await prisma.adminSettings.updateMany({ data: { globalTar1090BaseUrl: "http://10.0.0.5" } });
    expect((await post()).status).toBe(201);
    expect(urls[0]).toMatch(/^http:\/\/10\.0\.0\.5\//);
  });

  it.each([
    ["404 everywhere", () => ({ status: 404, data: "" }), 404, "RECEIVER_NOT_FOUND"],
    ["a 401", () => httpError(401), 502, "RECEIVER_AUTH"],
    ["a 500", () => httpError(500), 502, "RECEIVER_ERROR"],
    ["a timeout", () => codeError("ECONNABORTED"), 504, "RECEIVER_TIMEOUT"],
    ["a refused connection", () => codeError("ECONNREFUSED"), 502, "RECEIVER_UNREACHABLE"],
    [
      "an HTML page instead of a trace",
      () => ({ status: 200, data: "<html>" }),
      502,
      "RECEIVER_BAD_TRACE",
    ],
    [
      "a trace of another day only",
      () => ({
        status: 200,
        data: traceFile(cruiseRows(40_000, 20), { timestamp: DAY_START_S }),
      }),
      422,
      "RECEIVER_OUTSIDE_WINDOW",
    ],
  ])("reports %s as its own reason", async (_name, answer, status, code) => {
    respond = () => answer();
    const res = await post();
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
    expect(await prisma.flightTrack.findUnique({ where: { flightId } })).toBeNull();
  });

  describe("a flight across midnight UTC", () => {
    const NIGHT = Date.parse("2026-10-12T23:30:00Z");
    let nightId: string;
    const day2 = (url: string) => url.includes("/2026/10/13/");

    beforeEach(async () => {
      nightId = (
        await prisma.flight.create({
          data: {
            userId,
            depIata: "FRA",
            arrIata: "JFK",
            depLat: 50,
            depLon: 8,
            arrLat: 40.6,
            arrLon: -73.8,
            flightNumber: "LH400",
            aircraftModeS: HEX,
            departureTime: new Date(NIGHT),
            arrivalTime: new Date(NIGHT + 3_600_000),
            status: "flown",
          },
        })
      ).id;
    });

    it("joins the two day files into one line", async () => {
      respond = (url) =>
        day2(url)
          ? { status: 200, data: traceFile(cruiseRows(0, 30), { timestamp: DAY_START_S + 86_400 }) }
          : url.includes("/2026/10/12/")
            ? { status: 200, data: traceFile(cruiseRows(84_600, 30)) }
            : { status: 404, data: "" };
      const res = await post(nightId);
      expect(res.status).toBe(201);
      expect(res.body.track.pointCount).toBe(60);
    });

    it("does not truncate when the receiver serves the same file for both days", async () => {
      respond = (url) =>
        url.includes("/data/traces/")
          ? { status: 200, data: traceFile(cruiseRows(84_600, 90)) }
          : { status: 404, data: "" };
      const res = await post(nightId);
      expect(res.status).toBe(201);
      expect(res.body.track.pointCount).toBe(90);
    });

    it("reports a failed day instead of storing half a flight over a complete server line", async () => {
      const columns = flightTrackColumns(
        Array.from({ length: 10 }, (_, i) => ({ t: NIGHT + i * 60_000, lat: 51, lon: 8 + i * 0.1 }))
      )!;
      await prisma.flightTrack.create({
        data: { ...columns, flightId: nightId, source: "aeroapi", uploadId: "aeroapi:y" },
      });
      respond = (url) =>
        day2(url)
          ? codeError("ECONNABORTED")
          : url.includes("/2026/10/12/")
            ? { status: 200, data: traceFile(cruiseRows(84_600, 30)) }
            : { status: 404, data: "" };
      const res = await post(nightId);
      expect(res.status).toBe(504);
      expect(res.body.code).toBe("RECEIVER_TIMEOUT");
      expect(
        (await prisma.flightTrack.findUniqueOrThrow({ where: { flightId: nightId } })).source
      ).toBe("aeroapi");
    });
  });

  it("refuses a leg that spans the flight but holds no fix during it", async () => {
    // The flight flew 10:00-11:00Z (window 09:30-11:30); fixes only at 09:00-09:10 and 12:00-12:10, one leg.
    const day = await prisma.flight.update({
      where: { id: flightId },
      data: {
        departureTime: new Date("2026-10-12T10:00:00Z"),
        arrivalTime: new Date("2026-10-12T11:00:00Z"),
      },
    });
    respond = () => ({
      status: 200,
      data: traceFile([...cruiseRows(32_400, 10, 0), ...cruiseRows(43_200, 10, 0)]),
    });
    const res = await post(day.id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("RECEIVER_OUTSIDE_WINDOW");
  });
});
