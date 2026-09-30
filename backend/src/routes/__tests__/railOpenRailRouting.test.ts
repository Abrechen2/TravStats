import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { railCreationLimiter } from "../../middleware/rateLimit";
import { updateInstanceSettings } from "../../services/instanceSettingsService";
import { __clearRailHttpCache } from "../../services/rail/lookup/railHttp";
import { greatCircleKm } from "../../services/rail/railJourneyWrite";
import {
  BERLIN,
  FRANKFURT,
  FULDA,
  mockFetch,
  tracedLine,
  tripAnswer,
  TRIP_ID,
  type FetchMock,
} from "../../services/rail/lookup/__tests__/railFetchMock";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A self-hosted OpenRailRouting draws the line of a journey that has no
 * Transitous trace (rail-domain phase 3). What the user must be able to see:
 * a routed line is labelled `openrailrouting`, a failure keeps the chord under
 * the name `straight` and says why, and a failed re-fetch never trades a
 * stored trace for something worse. Every answer is mocked.
 */

const ORR = "http://orr.lan:8989";
/** A detour the chord does not take. */
const HANNOVER = { lat: 52.3765, lon: 9.741 };
const station = (s: { name: string; lat: number; lon: number }) => ({ ...s, country: "DE" });

/** A GraphHopper /route answer: a dense line through the stops. */
const routeAnswer = (stops: ReadonlyArray<{ lat: number; lon: number }>) => ({
  paths: [{ distance: 123_456, points: { type: "LineString", coordinates: tracedLine(stops) } }],
});

describe("Rail journeys and the instance's OpenRailRouting", () => {
  let cookie: string;
  let userId: string;
  let adminCookie: string;
  let adminId: string;
  let fetchMock: FetchMock | null = null;

  const mock = (routes: Parameters<typeof mockFetch>[0]): FetchMock => {
    fetchMock?.restore();
    fetchMock = mockFetch(routes);
    return fetchMock;
  };
  const plainJourney = (extra: Record<string, unknown> = {}) => ({
    trainCategory: "ICE",
    trainNumber: "696",
    departureStation: station(FRANKFURT),
    arrivalStation: station(BERLIN),
    departureLocal: "2026-09-26T06:15",
    arrivalLocal: "2026-09-26T10:43",
    ...extra,
  });
  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/rail").set("Cookie", cookie).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/rail/${id}`).set("Cookie", cookie).send(body);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["railorr", "railorradmin"] } } });
    const user = await prisma.user.create({
      data: { username: "railorr", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const admin = await prisma.user.create({
      data: { username: "railorradmin", passwordHash: await hashPassword("x"), isAdmin: true },
    });
    adminId = admin.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
  });

  beforeEach(async () => {
    __clearRailHttpCache();
    await updateInstanceSettings({
      railTransitousEnabled: true,
      railDbRestEnabled: true,
      railRoutingUrl: ORR,
    });
  });

  afterEach(async () => {
    fetchMock?.restore();
    fetchMock = null;
    await prisma.railJourney.deleteMany({ where: { userId } });
    await railCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await updateInstanceSettings({ railRoutingUrl: null });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
    await prisma.$disconnect();
  });

  describe("saving a journey without a Transitous match", () => {
    it("routes the line over the tracks in ONE request and says it was routed", async () => {
      const m = mock([[/orr\.lan:8989\/route/, routeAnswer([FRANKFURT, HANNOVER, BERLIN])]]);
      const res = await create(plainJourney());
      expect(res.status).toBe(201);
      expect(m.calls).toHaveLength(1);
      const url = new URL(m.calls[0]);
      expect(url.searchParams.getAll("point")).toEqual([
        `${FRANKFURT.lat},${FRANKFURT.lon}`,
        `${BERLIN.lat},${BERLIN.lon}`,
      ]);
      expect(url.searchParams.get("profile")).toBe("all_tracks");
      const row = res.body.data;
      expect(row.geometrySource).toBe("openrailrouting");
      expect(row.geometry[0]).toEqual([FRANKFURT.lon, FRANKFURT.lat]);
      expect(row.geometry[row.geometry.length - 1]).toEqual([BERLIN.lon, BERLIN.lat]);
      // Along the tracks (via Hannover here), well longer than the chord.
      expect(row.distanceSource).toBe("route");
      const chord = greatCircleKm({
        depLat: FRANKFURT.lat,
        depLon: FRANKFURT.lon,
        arrLat: BERLIN.lat,
        arrLon: BERLIN.lon,
      });
      expect(row.distanceKm).toBeGreaterThan(chord + 50);
      expect(res.body.meta.geometry).toEqual({
        outcome: "routed",
        geometrySource: "openrailrouting",
        fallback: null,
      });
    });

    it("keeps the straight line under its own name when OpenRailRouting is down, and says so", async () => {
      mock([[/orr\.lan:8989\/route/, { message: "Internal error" }, 503]]);
      const res = await create(plainJourney());
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        geometrySource: "straight",
        geometry: null,
        distanceSource: "great_circle",
      });
      expect(res.body.meta.geometry).toEqual({
        outcome: "straight",
        geometrySource: "straight",
        fallback: "railRoutingUnavailable",
      });
    });

    it("tells a missing connection apart from a dead server", async () => {
      mock([[/orr\.lan:8989\/route/, { message: "Connection between locations not found" }, 400]]);
      const res = await create(plainJourney());
      expect(res.body.meta.geometry.fallback).toBe("railRoutingNoRoute");
      expect(res.body.data.geometrySource).toBe("straight");
    });

    it("treats a timeout as unavailable, not as a route", async () => {
      const spy = jest.spyOn(global, "fetch").mockRejectedValue(
        Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        })
      );
      try {
        const res = await create(plainJourney());
        expect(res.status).toBe(201);
        expect(res.body.data.geometrySource).toBe("straight");
        expect(res.body.meta.geometry.fallback).toBe("railRoutingUnavailable");
      } finally {
        spy.mockRestore();
      }
    });

    it("refuses an answer that is not a line", async () => {
      mock([[/orr\.lan:8989\/route/, { paths: [] }]]);
      const res = await create(plainJourney());
      expect(res.body.data.geometrySource).toBe("straight");
      expect(res.body.meta.geometry.fallback).toBe("railRoutingUnavailable");
    });

    it("asks nobody and reports nothing when no OpenRailRouting is configured", async () => {
      await updateInstanceSettings({ railRoutingUrl: null });
      const m = mock([]);
      const res = await create(plainJourney());
      expect(m.calls).toEqual([]);
      expect(res.body.meta.geometry).toEqual({
        outcome: "straight",
        geometrySource: "straight",
        fallback: null,
      });
    });
  });

  describe("a Transitous match and OpenRailRouting together", () => {
    const matched = () => plainJourney({ lookup: { provider: "transitous", ref: TRIP_ID } });

    it("prefers the train's own trace and never asks OpenRailRouting for it", async () => {
      const m = mock([
        [/api\/v6\/trip/, tripAnswer(tracedLine([FRANKFURT, FULDA, BERLIN]))],
        [/orr\.lan/, routeAnswer([FRANKFURT, BERLIN])],
      ]);
      const res = await create(matched());
      expect(res.body.data.geometrySource).toBe("transitous");
      expect(m.calls.some((c) => c.includes("orr.lan"))).toBe(false);
    });

    it("routes when the trace fails, and still says the trace failed", async () => {
      mock([
        [/api\/v6\/trip/, { error: "down" }, 503],
        [/orr\.lan:8989\/route/, routeAnswer([FRANKFURT, FULDA, BERLIN])],
      ]);
      const res = await create(matched());
      expect(res.body.data.geometrySource).toBe("openrailrouting");
      expect(res.body.meta.geometry).toEqual({
        outcome: "routed",
        geometrySource: "openrailrouting",
        fallback: "providerUnavailable",
      });
    });

    it("keeps a stored trace when an edit's re-fetch fails, instead of trading it for a routed line", async () => {
      mock([[/api\/v6\/trip/, tripAnswer(tracedLine([FRANKFURT, FULDA, BERLIN]))]]);
      const created = (await create(matched())).body.data;
      expect(created.geometrySource).toBe("transitous");

      __clearRailHttpCache();
      const m = mock([
        [/api\/v6\/trip/, { error: "down" }, 503],
        [/orr\.lan:8989\/route/, routeAnswer([FRANKFURT, FULDA])],
      ]);
      const res = await patch(created.id, { arrivalStation: station(FULDA) });
      expect(res.status).toBe(200);
      expect(m.calls.some((c) => c.includes("orr.lan"))).toBe(true);
      expect(res.body.data.geometrySource).toBe("transitous");
      const line = res.body.data.geometry;
      expect(line[line.length - 1]).toEqual([FULDA.lon, FULDA.lat]);
      expect(res.body.meta.geometry).toMatchObject({
        outcome: "kept",
        geometrySource: "transitous",
        fallback: "providerUnavailable",
      });
    });
  });

  describe("the admin setting", () => {
    const put = (body: Record<string, unknown>, who = adminCookie) =>
      request(app).put("/api/v1/admin/instance-settings").set("Cookie", who).send(body);
    const test = (body: Record<string, unknown> = {}) =>
      request(app)
        .post("/api/v1/admin/instance-settings/rail-routing/test")
        .set("Cookie", adminCookie)
        .send(body);

    it("stores a normalised URL, and an empty one switches it off", async () => {
      let res = await put({ railRoutingUrl: " https://orr.example.org/api/ " });
      expect(res.status).toBe(200);
      expect(res.body.settings.railRoutingUrl).toBe("https://orr.example.org/api");
      res = await put({ railRoutingUrl: "" });
      expect(res.body.settings.railRoutingUrl).toBeNull();
    });

    it("refuses a URL with credentials, another scheme, or a query", async () => {
      for (const bad of ["http://u:p@orr.lan", "ftp://orr.lan", "http://orr.lan/?k=1", "orr"]) {
        const res = await put({ railRoutingUrl: bad });
        expect(res.status).toBe(400);
      }
    });

    it("is an admin's setting only", async () => {
      const res = await put({ railRoutingUrl: ORR }, cookie);
      expect(res.status).toBe(403);
    });

    it("tests the typed URL against /info and names the profile", async () => {
      const m = mock([
        [
          /typed\.lan\/info/,
          { profiles: [{ name: "all_tracks" }, { name: "tgv_all" }], data_date: "2026-09-10" },
        ],
      ]);
      const res = await test({ url: "http://typed.lan/" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, profile: "all_tracks", dataDate: "2026-09-10" });
      expect(m.calls).toEqual(["http://typed.lan/info"]);
    });

    it("answers each failure with a code of its own", async () => {
      mock([[/orr\.lan:8989\/info/, { profiles: [{ name: "car" }] }]]);
      expect((await test()).body).toEqual({ ok: false, code: "profileMissing" });
      mock([[/orr\.lan:8989\/info/, { hello: "world" }]]);
      expect((await test()).body).toEqual({ ok: false, code: "notOpenRailRouting" });
      mock([[/orr\.lan:8989\/info/, {}, 502]]);
      expect((await test()).body).toEqual({ ok: false, code: "unreachable" });
      await updateInstanceSettings({ railRoutingUrl: null });
      expect((await test()).body).toEqual({ ok: false, code: "notConfigured" });
    });
  });
});
