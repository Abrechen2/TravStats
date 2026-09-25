import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { railCreationLimiter, railLookupLimiter } from "../../middleware/rateLimit";
import { updateInstanceSettings } from "../../services/instanceSettingsService";
import { __clearRailHttpCache } from "../../services/rail/lookup/railHttp";
import {
  BERLIN,
  FRANKFURT,
  FULDA,
  mockFetch,
  stopTimesPage,
  tracedLine,
  tripAnswer,
  TRIP_ID,
  type FetchMock,
} from "../../services/rail/lookup/__tests__/railFetchMock";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The train-number lookup over HTTP, and what a match does to a saved
 * journey: the traced line is fetched ONCE, frozen with the row, labelled
 * `transitous`, and never presented when it is really a chain of chords.
 * Every provider answer is mocked; an unknown URL fails the test.
 */

const station = (s: { name: string; lat: number; lon: number }) => ({ ...s, country: "DE" });
const FROM_FRANKFURT = `fromLat=${FRANKFURT.lat}&fromLon=${FRANKFURT.lon}`;

describe("Rail lookup API", () => {
  let cookie: string;
  let userId: string;
  let adminCookie: string;
  let adminId: string;
  let fetchMock: FetchMock | null = null;

  const mock = (routes: Parameters<typeof mockFetch>[0]): FetchMock => {
    fetchMock = mockFetch(routes);
    return fetchMock;
  };
  const tracedTrip = () =>
    mock([
      [/api\.transitous\.org\/api\/v6\/trip/, tripAnswer(tracedLine([FRANKFURT, FULDA, BERLIN]))],
    ]);

  const journey = (extra: Record<string, unknown> = {}) => ({
    trainCategory: "ICE",
    trainNumber: "696",
    departureStation: station(FRANKFURT),
    arrivalStation: station(BERLIN),
    departureLocal: "2026-09-26T06:15",
    arrivalLocal: "2026-09-26T10:43",
    lookup: { provider: "transitous", ref: TRIP_ID },
    ...extra,
  });
  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/rail").set("Cookie", cookie).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/rail/${id}`).set("Cookie", cookie).send(body);

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["raillookup", "raillookupadmin"] } },
    });
    const user = await prisma.user.create({
      data: { username: "raillookup", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const admin = await prisma.user.create({
      data: {
        username: "raillookupadmin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
      },
    });
    adminId = admin.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
  });

  beforeEach(async () => {
    __clearRailHttpCache();
    await updateInstanceSettings({ railTransitousEnabled: true, railDbRestEnabled: true });
  });

  afterEach(async () => {
    fetchMock?.restore();
    fetchMock = null;
    await prisma.railJourney.deleteMany({ where: { userId } });
    await railLookupLimiter.resetKey(`user:${userId}`);
    await railCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await updateInstanceSettings({ railTransitousEnabled: true, railDbRestEnabled: true });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
    await prisma.$disconnect();
  });

  describe("GET /api/v1/rail/lookup", () => {
    it("needs a boarding station — no open service finds a train by its number alone", async () => {
      const res = await request(app)
        .get("/api/v1/rail/lookup?trainNumber=ICE%20696&date=2026-09-26")
        .set("Cookie", cookie);
      expect(res.status).toBe(400);
    });

    it("refuses a date that is not a date", async () => {
      const res = await request(app)
        .get(`/api/v1/rail/lookup?trainNumber=696&date=2026-02-30x&${FROM_FRANKFURT}`)
        .set("Cookie", cookie);
      expect(res.status).toBe(400);
    });

    it("answers a match with the provider's stops and says which provider it was", async () => {
      mock([
        [/stoptimes/, stopTimesPage("2026-09-26")],
        [/api\/v6\/trip/, tripAnswer(tracedLine([FRANKFURT, FULDA, BERLIN]))],
      ]);
      const res = await request(app)
        .get(`/api/v1/rail/lookup?trainNumber=ICE%20696&date=2026-09-26&${FROM_FRANKFURT}`)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.match).toMatchObject({
        provider: "transitous",
        ref: TRIP_ID,
        trainCategory: "ICE",
        trainNumber: "696",
        hasGeometry: true,
      });
      expect(res.body.data.match.stops).toHaveLength(3);
      expect(res.body.data.attempts).toEqual([{ provider: "transitous", outcome: "matched" }]);
    });

    it("has a tight bucket of its own — every call reaches a volunteer-run service", async () => {
      mock([
        [/stoptimes/, { stopTimes: [] }],
        [/db\.transport\.rest/, []],
      ]);
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await request(app)
          .get(`/api/v1/rail/lookup?trainNumber=1&date=2026-09-26&${FROM_FRANKFURT}`)
          .set("Cookie", cookie);
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
      expect(statuses[10]).toBe(429);
    });
  });

  describe("provider switches", () => {
    it("tells every user which providers the instance may ask, and links Transitous' sources", async () => {
      const res = await request(app).get("/api/v1/rail/lookup/providers").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        transitous: true,
        dbRest: true,
        transitousSourcesUrl: "https://transitous.org/sources/",
      });
    });

    it("lets an admin switch a provider off, and only an admin", async () => {
      const denied = await request(app)
        .put("/api/v1/admin/instance-settings")
        .set("Cookie", cookie)
        .send({ railDbRestEnabled: false });
      expect(denied.status).toBe(403);

      const res = await request(app)
        .put("/api/v1/admin/instance-settings")
        .set("Cookie", adminCookie)
        .send({ railDbRestEnabled: false });
      expect(res.status).toBe(200);
      expect(res.body.settings).toMatchObject({
        railTransitousEnabled: true,
        railDbRestEnabled: false,
      });
      const providers = await request(app)
        .get("/api/v1/rail/lookup/providers")
        .set("Cookie", cookie);
      expect(providers.body.data).toMatchObject({ transitous: true, dbRest: false });
    });
  });

  describe("the line a saved journey is drawn with", () => {
    it("freezes the traced line between the two stations and measures along it", async () => {
      tracedTrip();
      const res = await create(journey({ arrivalStation: station(FULDA) }));
      expect(res.status).toBe(201);
      const row = res.body.data;
      expect(row).toMatchObject({
        geometrySource: "transitous",
        lookupProvider: "transitous",
        lookupRef: TRIP_ID,
        distanceSource: "route",
      });
      // The ride, not the whole trip: it starts at Frankfurt and ends at Fulda.
      expect(row.geometry[0]).toEqual([FRANKFURT.lon, FRANKFURT.lat]);
      expect(row.geometry[row.geometry.length - 1]).toEqual([FULDA.lon, FULDA.lat]);
      expect(row.distanceKm).toBeGreaterThan(80);
      expect(row.distanceKm).toBeLessThan(95);
    });

    it("stores a chain of station-to-station chords as straight, never as transitous", async () => {
      mock([[/api\/v6\/trip/, tripAnswer([FRANKFURT, FULDA, BERLIN].map((s) => [s.lon, s.lat]))]]);
      const res = await create(journey());
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        geometrySource: "straight",
        geometry: null,
        distanceSource: "great_circle",
        // The match itself is still recorded.
        lookupProvider: "transitous",
      });
    });

    it("falls back to the straight line when Transitous does not answer at save time", async () => {
      mock([[/api\/v6\/trip/, { error: "down" }, 503]]);
      const res = await create(journey());
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ geometrySource: "straight", geometry: null });
    });

    it("asks nobody when the admin switched Transitous off", async () => {
      await updateInstanceSettings({ railTransitousEnabled: false });
      const m = mock([]);
      const res = await create(journey());
      expect(res.status).toBe(201);
      expect(res.body.data.geometrySource).toBe("straight");
      expect(m.calls).toEqual([]);
    });

    it("keeps a typed distance over the traced length", async () => {
      tracedTrip();
      const res = await create(journey({ distanceKm: 555 }));
      expect(res.body.data).toMatchObject({
        geometrySource: "transitous",
        distanceKm: 555,
        distanceSource: "user",
      });
    });

    it("does not fetch again for an edit that leaves the stations alone, and keeps the traced length", async () => {
      const m = tracedTrip();
      const created = (await create(journey())).body.data;
      __clearRailHttpCache();
      const callsBefore = m.calls.length;

      const res = await patch(created.id, { notes: "Wagen 7 war voll" });
      expect(res.status).toBe(200);
      expect(m.calls).toHaveLength(callsBefore);
      expect(res.body.data.geometry).toEqual(created.geometry);
      expect(res.body.data).toMatchObject({
        geometrySource: "transitous",
        distanceSource: "route",
        distanceKm: created.distanceKm,
      });
    });

    it("cuts the line again when the arrival moves to another stop of the same train", async () => {
      tracedTrip();
      const created = (await create(journey())).body.data;
      const res = await patch(created.id, { arrivalStation: station(FULDA) });
      expect(res.status).toBe(200);
      const line = res.body.data.geometry;
      expect(line[line.length - 1]).toEqual([FULDA.lon, FULDA.lat]);
      expect(res.body.data.distanceKm).toBeLessThan(created.distanceKm);
    });

    it("drops the line with the match", async () => {
      tracedTrip();
      const created = (await create(journey())).body.data;
      const res = await patch(created.id, { lookup: null });
      expect(res.body.data).toMatchObject({
        lookupProvider: null,
        lookupRef: null,
        geometry: null,
        geometrySource: "straight",
        distanceSource: "great_circle",
      });
    });
  });
});
