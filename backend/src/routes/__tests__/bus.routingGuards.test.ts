jest.mock("../../services/tour/routing/resolveProvider", () => ({
  resolveRouteProvider: jest.fn(),
  describeRoutingAvailability: jest.fn(),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { RATE_LIMITS } from "../../config/constants";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { busCreationLimiter } from "../../middleware/rateLimit";
import { busRouteLimiter } from "../../middleware/busRouteLimiter";
import { resolveRouteProvider } from "../../services/tour/routing/resolveProvider";
import { resetProviderBudget } from "../../services/tour/routing/providerBudget";
import { clearRouteAllState } from "../../services/bus/busRouteAgain";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import type { RouteProvider, RouteResult } from "../../services/tour/routing/types";

const mockResolve = resolveRouteProvider as jest.Mock<Promise<RouteProvider | null>>;
const SEOUL = { name: "Seoul Express Bus Terminal", lat: 37.5048, lon: 127.0046, country: "KR" };
const SOKCHO = { name: "Sokcho Express Bus Terminal", lat: 38.1911, lon: 128.5918, country: "KR" };
const road: RouteResult = {
  waypoints: [
    [SEOUL.lon, SEOUL.lat],
    [127.9, 37.9],
    [SOKCHO.lon, SOKCHO.lat],
  ],
  distanceKm: 211.4,
  drivingMinutes: 150,
};
const base = {
  departureStation: SEOUL,
  arrivalStation: SOKCHO,
  departureLocal: "2026-09-20T09:00",
  arrivalLocal: "2026-09-20T11:20",
};

describe("Bus routing guards: demo account, one daily budget, bulk cool-down", () => {
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  const route = jest.fn();
  const original = { ...RATE_LIMITS };
  const post = (who: string, body = base) =>
    request(app).post("/api/v1/bus").set("Cookie", cookies[who]).send(body);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["guarda", "guardb", "demo"] } } });
    for (const [name, isDemo] of [
      ["guarda", false],
      ["guardb", false],
      ["demo", true],
    ] as const) {
      const u = await prisma.user.create({
        data: { username: name, passwordHash: await hashPassword("password123"), isDemo },
      });
      ids[name] = u.id;
      cookies[name] = `auth_token=${generateToken(u.id)}`;
    }
  });

  beforeEach(() => {
    route.mockReset();
    route.mockResolvedValue(road);
    mockResolve.mockReset();
    mockResolve.mockResolvedValue({ id: "graphhopper", route });
    resetProviderBudget();
    clearRouteAllState();
    clearJobs();
    Object.assign(RATE_LIMITS, original);
  });

  afterEach(async () => {
    await settleAllJobs();
    await prisma.busJourney.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    for (const id of Object.values(ids)) {
      await busCreationLimiter.resetKey(`user:${id}`);
      await busRouteLimiter.resetKey(`user:${id}`);
    }
  });

  afterAll(async () => {
    Object.assign(RATE_LIMITS, original);
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  it("the shared demo account saves a straight line and never reaches the provider", async () => {
    const res = await post("demo");
    expect(res.status).toBe(201);
    expect(route).not.toHaveBeenCalled();
    expect(res.body.data.geometrySource).toBe("straight");
    expect(res.body.meta.geometry.fallback).toBe("no_provider");
    const patched = await request(app)
      .patch(`/api/v1/bus/${res.body.data.id}`)
      .set("Cookie", cookies.demo)
      .send({ arrivalStation: { ...SOKCHO, lat: 38.5, lon: 128.7 } });
    expect(patched.status).toBe(200);
    expect(route).not.toHaveBeenCalled();
    const routing = await request(app).get("/api/v1/bus/routing").set("Cookie", cookies.demo);
    expect(routing.body.data.configured).toBe(false);
  });

  it("an exhausted per-user budget makes the save a straight line with rate_limited, and calls nothing more", async () => {
    (RATE_LIMITS as { ROUTING_CALLS_PER_USER_PER_DAY: number }).ROUTING_CALLS_PER_USER_PER_DAY = 2;
    expect((await post("guarda")).body.data.geometrySource).toBe("road");
    expect((await post("guarda")).body.data.geometrySource).toBe("road");
    const third = await post("guarda");
    expect(third.status).toBe(201);
    expect(third.body.data.geometrySource).toBe("straight");
    expect(third.body.meta.geometry.fallback).toBe("rate_limited");
    expect(route).toHaveBeenCalledTimes(2);
  });

  it("two users share the instance cap", async () => {
    (
      RATE_LIMITS as { ROUTING_CALLS_PER_INSTANCE_PER_DAY: number }
    ).ROUTING_CALLS_PER_INSTANCE_PER_DAY = 3;
    await post("guarda");
    await post("guardb");
    await post("guarda");
    const last = await post("guardb");
    expect(last.body.meta.geometry.fallback).toBe("rate_limited");
    expect(route).toHaveBeenCalledTimes(3);
  });

  it("an instance without a provider spends none of the budget", async () => {
    mockResolve.mockResolvedValue(null);
    (RATE_LIMITS as { ROUTING_CALLS_PER_USER_PER_DAY: number }).ROUTING_CALLS_PER_USER_PER_DAY = 1;
    await post("guarda");
    await post("guarda");
    mockResolve.mockResolvedValue({ id: "graphhopper", route });
    expect((await post("guarda")).body.data.geometrySource).toBe("road");
  });

  describe("bulk job", () => {
    const start = (as = "guarda") =>
      request(app).post("/api/v1/bus/route-straight").set("Cookie", cookies[as]);
    const poll = async (jobId: string, as = "guarda") => {
      await settleAllJobs();
      return (await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookies[as])).body.data;
    };
    const seedStraight = async (n: number) => {
      mockResolve.mockResolvedValue(null);
      for (let i = 0; i < n; i++) {
        await post("guarda", {
          ...base,
          departureLocal: `2026-09-${10 + i}T09:00`,
          arrivalLocal: `2026-09-${10 + i}T11:00`,
        });
      }
      mockResolve.mockResolvedValue({ id: "graphhopper", route });
      const { describeRoutingAvailability } = jest.requireMock(
        "../../services/tour/routing/resolveProvider"
      );
      describeRoutingAvailability.mockResolvedValue({
        configured: true,
        providerId: "graphhopper",
      });
    };

    it("stops at the daily cap with stoppedBy rate_limited", async () => {
      await seedStraight(4);
      (RATE_LIMITS as { ROUTING_CALLS_PER_USER_PER_DAY: number }).ROUTING_CALLS_PER_USER_PER_DAY =
        2;
      const job = await poll((await start()).body.data.jobId);
      expect(route).toHaveBeenCalledTimes(2);
      expect(job.result).toMatchObject({
        routed: 2,
        straight: 1,
        stoppedBy: "rate_limited",
        remaining: 1,
      });
    });

    it("a restart inside the cool-down answers the previous result and calls nothing", async () => {
      await seedStraight(2);
      const first = (await start()).body.data.jobId;
      await poll(first);
      route.mockClear();
      const again = await start();
      expect(again.status).toBe(202);
      expect(again.body.data.jobId).toBe(first);
      expect(route).not.toHaveBeenCalled();
    });
  });
});
