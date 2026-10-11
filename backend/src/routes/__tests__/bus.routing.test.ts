jest.mock("../../services/tour/routing/resolveProvider", () => ({
  resolveRouteProvider: jest.fn(),
  describeRoutingAvailability: jest.fn(),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { busCreationLimiter } from "../../middleware/rateLimit";
import { busRouteLimiter } from "../../middleware/busRouteLimiter";
import {
  describeRoutingAvailability,
  resolveRouteProvider,
} from "../../services/tour/routing/resolveProvider";
import { clearRouteAllState } from "../../services/bus/busRouteAgain";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { ROUTE_FALLBACK_REASONS } from "../../services/tour/routing/types";
import type { RouteFailure, RouteProvider, RouteResult } from "../../services/tour/routing/types";

const mockResolve = resolveRouteProvider as jest.Mock<Promise<RouteProvider | null>>;
const mockAvailability = describeRoutingAvailability as jest.Mock;

// Real terminals, so a fake provider's line anchors within the 1 km tolerance.
const SEOUL = { name: "Seoul Express Bus Terminal", lat: 37.5048, lon: 127.0046, country: "KR" };
const SOKCHO = { name: "Sokcho Express Bus Terminal", lat: 38.1911, lon: 128.5918, country: "KR" };
const JEONJU = { name: "Jeonju Express Bus Terminal", lat: 35.8402, lon: 127.1289, country: "KR" };

/** A road line that starts and ends exactly at the two terminals, longer than the chord. */
const roadBetween = (a: typeof SEOUL, b: typeof SEOUL): RouteResult => ({
  waypoints: [
    [a.lon, a.lat],
    [(a.lon + b.lon) / 2 + 0.2, (a.lat + b.lat) / 2 - 0.1],
    [b.lon, b.lat],
  ],
  distanceKm: 211.4,
  drivingMinutes: 150,
});

describe("Bus rides — road routing (B3)", () => {
  let cookie: string;
  let userId: string;
  let otherCookie: string;
  let otherUserId: string;
  let demoCookie: string;
  let demoUserId: string;
  const route = jest.fn<Promise<RouteResult | RouteFailure | null>, unknown[]>();

  const base = {
    operator: "Kobus",
    departureStation: SEOUL,
    arrivalStation: SOKCHO,
    departureLocal: "2026-09-20T09:00",
    arrivalLocal: "2026-09-20T11:20",
  };
  const create = (body: Record<string, unknown>, as = cookie) =>
    request(app).post("/api/v1/bus").set("Cookie", as).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/bus/${id}`).set("Cookie", cookie).send(body);
  const withProvider = () => mockResolve.mockResolvedValue({ id: "graphhopper", route });
  const withoutProvider = () => mockResolve.mockResolvedValue(null);

  /** A straight ride exactly as B1/B2 stored it, bypassing routing. */
  async function straightRide(overrides: Record<string, unknown> = {}) {
    withoutProvider();
    const res = await create({ ...base, ...overrides });
    expect(res.body.data.geometrySource).toBe("straight");
    return res.body.data.id as string;
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["busroute", "busrouteother", "demo"] } },
    });
    const make = async (username: string, isDemo = false) =>
      prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123"), isDemo },
      });
    const user = await make("busroute");
    const other = await make("busrouteother");
    const demo = await make("demo", true);
    userId = user.id;
    otherUserId = other.id;
    demoUserId = demo.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    otherCookie = `auth_token=${generateToken(other.id)}`;
    demoCookie = `auth_token=${generateToken(demo.id)}`;
  });

  beforeEach(() => {
    route.mockReset();
    mockResolve.mockReset();
    mockAvailability.mockReset();
    clearJobs();
  });

  afterEach(async () => {
    await settleAllJobs();
    await prisma.busJourney.deleteMany({
      where: { userId: { in: [userId, otherUserId, demoUserId] } },
    });
    for (const id of [userId, otherUserId, demoUserId]) {
      await busCreationLimiter.resetKey(`user:${id}`);
      await busRouteLimiter.resetKey(`user:${id}`);
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId, demoUserId] } } });
    await prisma.$disconnect();
  });

  describe("on create", () => {
    it("fetches the road once and freezes it: geometry, road source, the routed length as route distance", async () => {
      withProvider();
      route.mockResolvedValue(roadBetween(SEOUL, SOKCHO));
      const res = await create(base);
      expect(res.status).toBe(201);
      expect(route).toHaveBeenCalledTimes(1);
      expect(route.mock.calls[0][0]).toMatchObject({ mode: "road" });
      expect(res.body.data.geometrySource).toBe("road");
      expect(res.body.data.geometry).toHaveLength(3);
      expect(res.body.data.distanceKm).toBe(211.4);
      expect(res.body.data.distanceSource).toBe("route");
      expect(res.body.meta.geometry).toEqual({
        outcome: "routed",
        geometrySource: "road",
        fallback: null,
      });
    });

    it("keeps a distance typed from the ticket whichever line exists", async () => {
      withProvider();
      route.mockResolvedValue(roadBetween(SEOUL, SOKCHO));
      const res = await create({ ...base, distanceKm: 198 });
      expect(res.body.data.geometrySource).toBe("road");
      expect(res.body.data.distanceKm).toBe(198);
      expect(res.body.data.distanceSource).toBe("user");
    });

    it("without a provider stores the chord and answers fallback no_provider", async () => {
      withoutProvider();
      const res = await create(base);
      expect(res.status).toBe(201);
      expect(res.body.data.geometry).toBeNull();
      expect(res.body.data.geometrySource).toBe("straight");
      expect(res.body.data.distanceSource).toBe("great_circle");
      expect(res.body.meta.geometry).toEqual({
        outcome: "straight",
        geometrySource: "straight",
        fallback: "no_provider",
      });
    });

    it.each(ROUTE_FALLBACK_REASONS.filter((r) => r !== "no_provider" && r !== "unroutable_mode"))(
      "a provider that fails with %s stores the chord and names that reason",
      async (reason) => {
        withProvider();
        route.mockResolvedValue({ failure: reason });
        const res = await create(base);
        expect(res.status).toBe(201);
        expect(res.body.data.geometrySource).toBe("straight");
        expect(res.body.data.distanceSource).toBe("great_circle");
        expect(res.body.meta.geometry.fallback).toBe(reason);
        expect(res.body.meta.geometry.outcome).toBe("straight");
      }
    );

    it("a bare null from the provider reads as provider_error", async () => {
      withProvider();
      route.mockResolvedValue(null);
      const res = await create(base);
      expect(res.body.meta.geometry.fallback).toBe("provider_error");
    });

    it("a line that does not anchor at the terminals is untrustworthy, not stored as road", async () => {
      withProvider();
      route.mockResolvedValue(roadBetween(JEONJU, SOKCHO));
      const res = await create(base);
      expect(res.body.data.geometrySource).toBe("straight");
      expect(res.body.meta.geometry.fallback).toBe("untrustworthy");
    });

    it("a provider that throws still saves the ride, as a straight line", async () => {
      withProvider();
      route.mockRejectedValue(new Error("socket hang up"));
      const res = await create(base);
      expect(res.status).toBe(201);
      expect(res.body.meta.geometry.fallback).toBe("provider_error");
    });
  });

  describe("on edit", () => {
    it("an edit that moves no terminal does not ask the provider and keeps the frozen line and its distance", async () => {
      withProvider();
      route.mockResolvedValue(roadBetween(SEOUL, SOKCHO));
      const id = (await create(base)).body.data.id;
      route.mockClear();
      const res = await patch(id, {
        departureStation: SEOUL,
        arrivalStation: SOKCHO,
        seat: "12A",
      });
      expect(res.status).toBe(200);
      expect(route).not.toHaveBeenCalled();
      expect(res.body.meta.geometry.outcome).toBe("unchanged");
      expect(res.body.data.geometrySource).toBe("road");
      expect(res.body.data.distanceKm).toBe(211.4);
      expect(res.body.data.distanceSource).toBe("route");
    });

    it("a moved terminal fetches again and replaces the line", async () => {
      withProvider();
      route.mockResolvedValue(roadBetween(SEOUL, SOKCHO));
      const id = (await create(base)).body.data.id;
      route.mockResolvedValue({ ...roadBetween(SEOUL, JEONJU), distanceKm: 250.2 });
      const res = await patch(id, { arrivalStation: JEONJU });
      expect(route).toHaveBeenCalledTimes(2);
      expect(res.body.meta.geometry.outcome).toBe("routed");
      expect(res.body.data.distanceKm).toBe(250.2);
    });

    it("a failed re-fetch keeps the stored line when it still reaches both terminals", async () => {
      withProvider();
      route.mockResolvedValue(roadBetween(SEOUL, SOKCHO));
      const id = (await create(base)).body.data.id;
      route.mockResolvedValue({ failure: "rate_limited" });
      // Corrected by ~100 m: the road line still starts and ends there.
      const res = await patch(id, {
        departureStation: { ...SEOUL, lat: SEOUL.lat + 0.001 },
      });
      expect(res.body.meta.geometry).toEqual({
        outcome: "kept",
        geometrySource: "road",
        fallback: "rate_limited",
      });
      expect(res.body.data.geometrySource).toBe("road");
      expect(res.body.data.geometry).toHaveLength(3);
      expect(res.body.data.distanceKm).toBe(211.4);
      expect(res.body.data.distanceSource).toBe("route");
    });

    it("a failed re-fetch does not keep a line that no longer reaches a moved terminal", async () => {
      withProvider();
      route.mockResolvedValue(roadBetween(SEOUL, SOKCHO));
      const id = (await create(base)).body.data.id;
      route.mockResolvedValue({ failure: "no_route" });
      const res = await patch(id, { arrivalStation: JEONJU });
      expect(res.body.meta.geometry).toMatchObject({ outcome: "straight", fallback: "no_route" });
      expect(res.body.data.geometry).toBeNull();
      expect(res.body.data.distanceSource).toBe("great_circle");
    });

    it("clearing a typed distance measures it again along the road line that exists", async () => {
      withProvider();
      route.mockResolvedValue(roadBetween(SEOUL, SOKCHO));
      const id = (await create({ ...base, distanceKm: 198 })).body.data.id;
      const res = await patch(id, { distanceKm: null });
      expect(res.body.data.distanceSource).toBe("route");
      expect(res.body.data.distanceKm).toBeGreaterThan(150);
    });
  });

  describe("GET /bus/routing", () => {
    it("says whether the instance can route at all", async () => {
      mockAvailability.mockResolvedValue({ configured: false, providerId: null });
      const res = await request(app).get("/api/v1/bus/routing").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { configured: false, providerId: null } });
    });
  });

  describe("POST /bus/:id/route (route again)", () => {
    it("routes a straight ride, keeps a typed distance, and is idempotent", async () => {
      const id = await straightRide();
      const typed = await straightRide({ distanceKm: 198 });
      withProvider();
      route.mockResolvedValue(roadBetween(SEOUL, SOKCHO));
      const first = await request(app).post(`/api/v1/bus/${id}/route`).set("Cookie", cookie);
      expect(first.status).toBe(200);
      expect(first.body.meta.geometry.outcome).toBe("routed");
      expect(first.body.data.geometrySource).toBe("road");
      expect(first.body.data.distanceKm).toBe(211.4);
      expect(first.body.data.distanceSource).toBe("route");

      const again = await request(app).post(`/api/v1/bus/${id}/route`).set("Cookie", cookie);
      expect(again.body.meta.geometry.outcome).toBe("unchanged");
      expect(route).toHaveBeenCalledTimes(1);

      const kept = await request(app).post(`/api/v1/bus/${typed}/route`).set("Cookie", cookie);
      expect(kept.body.data.geometrySource).toBe("road");
      expect(kept.body.data.distanceKm).toBe(198);
      expect(kept.body.data.distanceSource).toBe("user");
    });

    it("answers 200 with the provider's reason when it does not deliver, and changes nothing", async () => {
      const id = await straightRide();
      withProvider();
      route.mockResolvedValue({ failure: "point_not_near_road" });
      const res = await request(app).post(`/api/v1/bus/${id}/route`).set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.meta.geometry).toEqual({
        outcome: "straight",
        geometrySource: "straight",
        fallback: "point_not_near_road",
      });
      expect(res.body.data.geometrySource).toBe("straight");
    });

    it("is owner-scoped (404 for a stranger's ride) and refused for the shared demo account", async () => {
      const id = await straightRide();
      withProvider();
      const stranger = await request(app)
        .post(`/api/v1/bus/${id}/route`)
        .set("Cookie", otherCookie);
      expect(stranger.status).toBe(404);
      const demo = await request(app).post(`/api/v1/bus/${id}/route`).set("Cookie", demoCookie);
      expect(demo.status).toBe(403);
      expect(route).not.toHaveBeenCalled();
    });
  });

  describe("POST /bus/route-straight (route all, as a job)", () => {
    const poll = async (jobId: string, as = cookie) => {
      await settleAllJobs();
      return (await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", as)).body.data;
    };

    it("routes every straight ride and reports each ride's outcome", async () => {
      const a = await straightRide();
      const b = await straightRide({ arrivalStation: JEONJU });
      withProvider();
      mockAvailability.mockResolvedValue({ configured: true, providerId: "graphhopper" });
      route.mockImplementation(async (req) => {
        const to = (req as { to: { lat: number } }).to;
        return to.lat === JEONJU.lat ? { failure: "no_route" } : roadBetween(SEOUL, SOKCHO);
      });
      const started = await request(app).post("/api/v1/bus/route-straight").set("Cookie", cookie);
      expect(started.status).toBe(202);
      const job = await poll(started.body.data.jobId);
      expect(job.kind).toBe("bus.routeStraight");
      expect(job.status).toBe("succeeded");
      expect(job.result).toMatchObject({
        straightRides: 2,
        attempted: 2,
        routed: 1,
        straight: 1,
        remaining: 0,
        stoppedBy: null,
      });
      const outcomes = Object.fromEntries(
        job.result.rides.map((r: { id: string; outcome: string }) => [r.id, r.outcome])
      );
      expect(outcomes[a]).toBe("routed");
      expect(outcomes[b]).toBe("straight");
      const rows = await prisma.busJourney.findMany({ where: { userId } });
      expect(rows.filter((r) => r.geometrySource === "road")).toHaveLength(1);
    });

    it("running it again with nothing left to route calls no provider (idempotent)", async () => {
      await straightRide();
      withProvider();
      mockAvailability.mockResolvedValue({ configured: true, providerId: "graphhopper" });
      route.mockResolvedValue(roadBetween(SEOUL, SOKCHO));
      await poll(
        (await request(app).post("/api/v1/bus/route-straight").set("Cookie", cookie)).body.data
          .jobId
      );
      route.mockClear();
      clearRouteAllState(); // past the restart cool-down
      const job = await poll(
        (await request(app).post("/api/v1/bus/route-straight").set("Cookie", cookie)).body.data
          .jobId
      );
      expect(job.result).toMatchObject({ straightRides: 0, attempted: 0 });
      expect(route).not.toHaveBeenCalled();
    });

    it("stops at a quota or key refusal instead of hammering the provider, and says what is left", async () => {
      await straightRide();
      await straightRide({ arrivalStation: JEONJU });
      withProvider();
      mockAvailability.mockResolvedValue({ configured: true, providerId: "graphhopper" });
      route.mockResolvedValue({ failure: "rate_limited" });
      const job = await poll(
        (await request(app).post("/api/v1/bus/route-straight").set("Cookie", cookie)).body.data
          .jobId
      );
      expect(route).toHaveBeenCalledTimes(1);
      expect(job.result).toMatchObject({ attempted: 1, stoppedBy: "rate_limited", remaining: 1 });
    });

    it("answers 409 BUS_NO_ROUTING_PROVIDER on an instance without a provider", async () => {
      await straightRide();
      mockAvailability.mockResolvedValue({ configured: false, providerId: null });
      const res = await request(app).post("/api/v1/bus/route-straight").set("Cookie", cookie);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("BUS_NO_ROUTING_PROVIDER");
    });

    it("refuses the shared demo account and reads only the caller's rides", async () => {
      const demo = await request(app).post("/api/v1/bus/route-straight").set("Cookie", demoCookie);
      expect(demo.status).toBe(403);
      await straightRide();
      withProvider();
      mockAvailability.mockResolvedValue({ configured: true, providerId: "graphhopper" });
      route.mockResolvedValue(roadBetween(SEOUL, SOKCHO));
      const started = await request(app)
        .post("/api/v1/bus/route-straight")
        .set("Cookie", otherCookie);
      const job = await poll(started.body.data.jobId, otherCookie);
      // The other user has no rides; this user's straight ride is not theirs to route.
      expect(job.result).toMatchObject({ straightRides: 0, attempted: 0 });
      expect(route).not.toHaveBeenCalled();
    });
  });

  it("rate-limits both routing endpoints, each request spending the instance's provider quota", async () => {
    const unknownId = "00000000-0000-4000-8000-000000000000";
    let last = 0;
    for (let i = 0; i < 61; i++) {
      last = (await request(app).post(`/api/v1/bus/${unknownId}/route`).set("Cookie", cookie))
        .status;
    }
    expect(last).toBe(429);
    const all = await request(app).post("/api/v1/bus/route-straight").set("Cookie", cookie);
    expect(all.status).toBe(429);
  });
});
