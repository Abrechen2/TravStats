import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { railCreationLimiter } from "../../middleware/rateLimit";
import { railRouteLimiter } from "../../middleware/railRouteLimiter";
import { updateInstanceSettings } from "../../services/instanceSettingsService";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { __clearRailHttpCache } from "../../services/rail/lookup/railHttp";
import { railRouteCache } from "../../services/rail/railRouteCache";
import {
  BERLIN,
  FRANKFURT,
  FULDA,
  tracedLine,
} from "../../services/rail/lookup/__tests__/railFetchMock";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Tram and U-Bahn rides route over their own network (tester report,
 * 2026-10-25: "Wird bei OpenRailRouting der Fahrzeugtyp übergeben?" — it was
 * not; every ride was routed as a train). What the user must see: a tram ride
 * asks the tram network, an instance that cannot route trams says so instead
 * of drawing the mainline, and a tram line routed as a train before the fix
 * can be routed again. Every OpenRailRouting answer is mocked.
 */

const ORR = "http://orr.lan:8989";
const HANNOVER = { lat: 52.3765, lon: 9.741 };
const station = (s: { name: string; lat: number; lon: number }) => ({ ...s, country: "DE" });

const routeAnswer = (stops: ReadonlyArray<{ lat: number; lon: number }>, railwayClass: string) => ({
  paths: [
    {
      snapped_waypoints: {
        coordinates: [stops[0], stops[stops.length - 1]].map((s) => [s.lon, s.lat]),
      },
      details: { railway_class: [[0, tracedLine(stops).length - 1, railwayClass]] },
      distance: 123_456,
      points: { type: "LineString", coordinates: tracedLine(stops) },
    },
  ],
});
const missingProfile = (name: string) => ({
  message: `The requested profile '${name}' does not exist.\nAvailable profiles: [all_tracks]`,
});
const CH_ONLY = {
  message:
    "The 'custom_model' parameter is currently not supported for speed mode, you need to disable speed mode with `ch.disable=true`.",
};

type Reply = { status?: number; body: unknown };

describe("Tram and U-Bahn rides and the instance's OpenRailRouting", () => {
  let cookie: string;
  let userId: string;
  let otherCookie: string;
  let otherId: string;
  let adminCookie: string;
  let adminId: string;
  let requests: Array<Record<string, unknown>>;

  /** Answer each /route request by the body it carries. */
  const router = (answer: (body: Record<string, unknown>) => Reply) => {
    requests = [];
    jest.spyOn(global, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      const reply = answer(body);
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    });
  };
  const ride = (extra: Record<string, unknown> = {}) => ({
    trainCategory: "STR",
    trainNumber: "16",
    departureStation: station(FRANKFURT),
    arrivalStation: station(BERLIN),
    departureLocal: "2026-09-26T06:15",
    arrivalLocal: "2026-09-26T10:43",
    ...extra,
  });
  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/rail").set("Cookie", cookie).send(body);
  const routeAgain = (id: string, who = cookie) =>
    request(app).post(`/api/v1/rail/${id}/route`).set("Cookie", who).send({});
  /** A tram ride as it was stored before 2026-10-26: routed as a train. */
  const routedAsTrain = async (transitMode = "tram") => {
    router(() => ({ body: routeAnswer([FRANKFURT, HANNOVER, BERLIN], "rail") }));
    const created = (await create(ride())).body.data;
    expect(created.geometrySource).toBe("openrailrouting");
    await prisma.railJourney.update({ where: { id: created.id }, data: { transitMode } });
    jest.mocked(global.fetch).mockRestore();
    return created;
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["railtram", "railtram2", "railtramadmin"] } },
    });
    const make = async (username: string, isAdmin = false) =>
      prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123"), isAdmin },
      });
    const user = await make("railtram");
    const other = await make("railtram2");
    const admin = await make("railtramadmin", true);
    [userId, otherId, adminId] = [user.id, other.id, admin.id];
    cookie = `auth_token=${generateToken(user.id)}`;
    otherCookie = `auth_token=${generateToken(other.id)}`;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
  });

  beforeEach(async () => {
    __clearRailHttpCache();
    clearJobs();
    jest.spyOn(railRouteCache, "get").mockResolvedValue(null);
    jest.spyOn(railRouteCache, "put").mockResolvedValue(undefined);
    await updateInstanceSettings({
      railTransitousEnabled: true,
      railDbRestEnabled: true,
      railRoutingUrl: ORR,
    });
  });

  afterEach(async () => {
    await settleAllJobs();
    jest.restoreAllMocks();
    await prisma.railJourney.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    for (const id of [userId, otherId]) {
      await railCreationLimiter.resetKey(`user:${id}`);
      await railRouteLimiter.resetKey(`user:${id}`);
    }
  });

  afterAll(async () => {
    await updateInstanceSettings({ railRoutingUrl: null });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId, adminId] } } });
    await prisma.$disconnect();
  });

  describe("saving", () => {
    it("routes a tram ride over the tram profile", async () => {
      router(() => ({ body: routeAnswer([FRANKFURT, FULDA, BERLIN], "tram") }));
      const res = await create(ride({ transitMode: "tram" }));
      expect(res.status).toBe(201);
      expect(requests.map((r) => r.profile)).toEqual(["tram"]);
      expect(res.body.data.geometrySource).toBe("openrailrouting");
    });

    it("routes a U-Bahn ride over the tracks restricted to the subway when the profile is missing", async () => {
      router((body) =>
        body.profile === "subway"
          ? { status: 400, body: missingProfile("subway") }
          : { body: routeAnswer([FRANKFURT, FULDA, BERLIN], "subway") }
      );
      const res = await create(ride({ transitMode: "metro" }));
      expect(res.body.data.geometrySource).toBe("openrailrouting");
      expect(requests[1]).toMatchObject({
        profile: "all_tracks",
        "ch.disable": true,
        custom_model: {
          priority: [
            { if: "!(railway_class == SUBWAY || railway_class == LIGHT_RAIL)", multiply_by: "0" },
          ],
        },
      });
    });

    it("keeps a tram ride straight, and says why, on an instance that cannot route trams", async () => {
      router((body) =>
        body.profile === "tram"
          ? { status: 400, body: missingProfile("tram") }
          : { status: 400, body: CH_ONLY }
      );
      const res = await create(ride({ transitMode: "tram" }));
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ geometrySource: "straight", geometry: null });
      expect(res.body.meta.geometry).toEqual({
        outcome: "straight",
        geometrySource: "straight",
        fallback: "railRoutingModeUnsupported",
      });
      for (const r of requests)
        if (r.profile === "all_tracks") expect(r.custom_model).toBeDefined();
    });

    it("routes a ride again when it is changed from a train to a tram", async () => {
      const old = await routedAsTrain("rail");
      router(() => ({ body: routeAnswer([FRANKFURT, FULDA, BERLIN], "tram") }));
      const res = await request(app)
        .patch(`/api/v1/rail/${old.id}`)
        .set("Cookie", cookie)
        .send({ transitMode: "tram" });
      expect(res.status).toBe(200);
      expect(requests.map((r) => r.profile)).toEqual(["tram"]);
      expect(res.body.data.geometry).not.toEqual(old.geometry);
    });
  });

  describe("route again", () => {
    it("replaces a tram line routed as a train with one over the tram network", async () => {
      const old = await routedAsTrain();
      router(() => ({ body: routeAnswer([FRANKFURT, FULDA, BERLIN], "tram") }));
      const res = await routeAgain(old.id);
      expect(res.status).toBe(200);
      expect(res.body.meta.geometry.outcome).toBe("routed");
      const saved = await prisma.railJourney.findUniqueOrThrow({ where: { id: old.id } });
      expect(saved.geometry).toEqual(res.body.data.geometry);
      expect(saved.geometry).not.toEqual(old.geometry);
    });

    it("drops a tram line routed as a train when the instance cannot route trams, and says why", async () => {
      const old = await routedAsTrain();
      router((body) =>
        body.profile === "tram"
          ? { status: 400, body: missingProfile("tram") }
          : { status: 400, body: CH_ONLY }
      );
      const res = await routeAgain(old.id);
      expect(res.status).toBe(200);
      expect(res.body.meta.geometry).toEqual({
        outcome: "straight",
        geometrySource: "straight",
        fallback: "railRoutingModeUnsupported",
      });
      const saved = await prisma.railJourney.findUniqueOrThrow({ where: { id: old.id } });
      expect(saved).toMatchObject({
        geometry: null,
        geometrySource: "straight",
        distanceSource: "great_circle",
      });
    });

    it("keeps the old line and names the reason while the router is down", async () => {
      const old = await routedAsTrain();
      router(() => ({ status: 503, body: { message: "down" } }));
      const res = await routeAgain(old.id);
      expect(res.body.meta.geometry).toMatchObject({
        outcome: "kept",
        fallback: "railRoutingUnavailable",
      });
      const saved = await prisma.railJourney.findUniqueOrThrow({ where: { id: old.id } });
      expect(saved.geometry).toEqual(old.geometry);
    });

    it("is the owner's only", async () => {
      const old = await routedAsTrain();
      router(() => ({ body: routeAnswer([FRANKFURT, FULDA, BERLIN], "tram") }));
      expect((await routeAgain(old.id, otherCookie)).status).toBe(404);
      expect(requests).toEqual([]);
    });
  });

  describe("the instance-wide repair", () => {
    const start = (who = adminCookie) =>
      request(app)
        .post("/api/v1/admin/instance-settings/rail-routing/reroute-local-transit")
        .set("Cookie", who)
        .send({});

    it("routes every tram and U-Bahn line again, and leaves trains alone", async () => {
      const tram = await routedAsTrain("tram");
      const metro = await routedAsTrain("metro");
      const train = await routedAsTrain("rail");
      router((body) =>
        body.profile === "tram"
          ? { body: routeAnswer([FRANKFURT, FULDA, BERLIN], "tram") }
          : { status: 400, body: { message: "Connection between locations not found" } }
      );
      const res = await start();
      expect(res.status).toBe(202);
      await settleAllJobs();
      const job = await request(app)
        .get(`/api/v1/jobs/${res.body.jobId}`)
        .set("Cookie", adminCookie);
      expect(job.body.data).toMatchObject({
        kind: "rail.rerouteLocalTransit",
        status: "succeeded",
        result: { total: 2, routed: 1, straight: 1, kept: 0, stoppedBy: null },
      });
      const rows = await prisma.railJourney.findMany({
        where: { id: { in: [tram.id, metro.id, train.id] } },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(tram.id)?.geometrySource).toBe("openrailrouting");
      expect(byId.get(tram.id)?.geometry).not.toEqual(tram.geometry);
      expect(byId.get(metro.id)?.geometrySource).toBe("straight");
      expect(byId.get(train.id)?.geometry).toEqual(train.geometry);
      expect(requests.every((r) => r.profile !== "all_tracks" || r.custom_model)).toBe(true);
    });

    it("is an admin's only, and refuses without a router", async () => {
      expect((await start(cookie)).status).toBe(403);
      await updateInstanceSettings({ railRoutingUrl: null });
      const res = await start();
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("notConfigured");
    });

    it("the connection test says which local-transit profiles exist", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            profiles: [{ name: "all_tracks" }, { name: "tram" }],
            data_date: "x",
          }),
          { status: 200 }
        )
      );
      const res = await request(app)
        .post("/api/v1/admin/instance-settings/rail-routing/test")
        .set("Cookie", adminCookie)
        .send({});
      expect(res.body).toEqual({
        ok: true,
        profile: "all_tracks",
        dataDate: "x",
        modeProfiles: { tram: true, subway: false },
      });
    });
  });
});
