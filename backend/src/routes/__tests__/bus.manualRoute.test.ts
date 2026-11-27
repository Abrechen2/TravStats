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
import { resolveRouteProvider } from "../../services/tour/routing/resolveProvider";
import { routeStraightRide } from "../../services/bus/busRouteAgain";
import { polylineLengthKm } from "../../shared/geo/haversine";
import type { RouteProvider, RouteResult } from "../../services/tour/routing/types";

const mockResolve = resolveRouteProvider as jest.Mock<Promise<RouteProvider | null>>;

// Helsinki -> Leningrad style ride: the router's answer is the wrong one.
const dep = { name: "Helsinki Kamppi", lat: 60.1685, lon: 24.9317, country: "FI" };
const arr = { name: "Vyborg test stop", lat: 60.709, lon: 28.7497, country: "RU" };
const via: Array<[number, number]> = [
  [26.9, 60.5],
  [27.8, 60.7],
];
const drawn = [[dep.lon, dep.lat], ...via, [arr.lon, arr.lat]];
const wrongRoad: RouteResult = {
  waypoints: [
    [dep.lon, dep.lat],
    [25.0, 59.4],
    [arr.lon, arr.lat],
  ],
  distanceKm: 709,
  drivingMinutes: 600,
};

describe("Bus rides - hand-drawn line (GitHub #409)", () => {
  let cookie: string, userId: string, otherCookie: string, otherId: string, demoCookie: string;
  let demoId: string;
  const route = jest.fn();
  const base = {
    departureStation: dep,
    arrivalStation: arr,
    departureLocal: "1977-06-01T09:00",
    arrivalLocal: "1977-06-01T15:00",
    lineName: "Line 1",
  };
  const put = (id: string, body: unknown, as = cookie) =>
    request(app)
      .put(`/api/v1/bus/${id}/route-override`)
      .set("Cookie", as)
      .send(body as object);
  const del = (id: string, as = cookie) =>
    request(app).delete(`/api/v1/bus/${id}/route-override`).set("Cookie", as);

  async function ride(extra: Record<string, unknown> = {}) {
    mockResolve.mockResolvedValue(null);
    const r = await request(app)
      .post("/api/v1/bus")
      .set("Cookie", cookie)
      .send({ ...base, ...extra });
    expect(r.status).toBe(201);
    return r.body.data.id as string;
  }
  const row = (id: string) => prisma.busJourney.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["busman", "busmanother", "demo"] } },
    });
    const make = async (username: string, isDemo = false) =>
      prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123"), isDemo },
      });
    const u = await make("busman");
    const o = await make("busmanother");
    const d = await make("demo", true);
    [userId, otherId, demoId] = [u.id, o.id, d.id];
    cookie = `auth_token=${generateToken(u.id)}`;
    otherCookie = `auth_token=${generateToken(o.id)}`;
    demoCookie = `auth_token=${generateToken(d.id)}`;
  });
  beforeEach(() => {
    route.mockReset();
    mockResolve.mockReset();
  });
  afterEach(async () => {
    await prisma.busJourney.deleteMany({ where: { userId: { in: [userId, otherId, demoId] } } });
    for (const id of [userId, otherId, demoId]) {
      await busCreationLimiter.resetKey(`user:${id}`);
      await busRouteLimiter.resetKey(`user:${id}`);
    }
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId, demoId] } } });
    await prisma.$disconnect();
  });

  it("stores a drawn line as manual, the distance following the polyline", async () => {
    const id = await ride();
    const res = await put(id, { waypoints: drawn });
    expect(res.status).toBe(200);
    const km = polylineLengthKm(drawn.map(([lon, lat]) => ({ lat, lon })));
    expect(await row(id)).toMatchObject({
      geometrySource: "manual",
      geometry: drawn,
      distanceSource: "route",
      distanceKm: Math.round(km * 10) / 10,
    });
    expect(res.body.data.geometrySource).toBe("manual");
  });

  it("snaps the ends onto the terminals", async () => {
    const id = await ride();
    const near = [[dep.lon + 0.002, dep.lat], ...via, [arr.lon, arr.lat - 0.002]];
    expect((await put(id, { waypoints: near })).status).toBe(200);
    expect((await row(id)).geometry).toEqual(drawn);
  });

  it("keeps a typed ticket distance when the line is drawn", async () => {
    const id = await ride({ distanceKm: 390 });
    await put(id, { waypoints: drawn });
    expect(await row(id)).toMatchObject({ geometrySource: "manual", distanceKm: 390 });
    expect((await row(id)).distanceSource).toBe("user");
  });

  it("keeps the ride straight on request: manual with no geometry, great-circle distance", async () => {
    mockResolve.mockResolvedValue({ id: "graphhopper", route });
    route.mockResolvedValue(wrongRoad);
    const created = await request(app).post("/api/v1/bus").set("Cookie", cookie).send(base);
    const id = created.body.data.id as string;
    expect(created.body.data.geometrySource).toBe("road");
    const res = await put(id, { keepStraight: true });
    expect(res.status).toBe(200);
    const stored = await row(id);
    expect(stored.geometrySource).toBe("manual");
    expect(stored.geometry).toBeNull();
    expect(stored.distanceSource).toBe("great_circle");
    expect(stored.distanceKm).toBeLessThan(500);
  });

  it.each([
    ["too few points", { waypoints: [drawn[0], drawn[3]] }, "BUS_ROUTE_INVALID"],
    [
      "a point outside the globe",
      { waypoints: [drawn[0], [999, 0], drawn[3]] },
      "BUS_ROUTE_INVALID",
    ],
    ["no body", {}, "BUS_ROUTE_INVALID"],
    ["ends away from the stops", { waypoints: [[0, 0], ...via, [1, 1]] }, "BUS_ROUTE_NOT_ANCHORED"],
  ])("refuses %s with its own code and writes nothing", async (_n, body, code) => {
    const id = await ride();
    const res = await put(id, body);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(code);
    expect((await row(id)).geometrySource).toBe("straight");
  });

  it("refuses a line far longer than the ride can be", async () => {
    const id = await ride();
    const res = await put(id, { waypoints: [drawn[0], [-120, 10], [120, -10], drawn[3]] });
    expect(res.status).toBe(400);
    expect((await row(id)).geometrySource).toBe("straight");
  });

  it("answers 404 for another user's ride, 403 for the demo account, 409 for a stale version", async () => {
    const id = await ride();
    expect((await put(id, { waypoints: drawn }, otherCookie)).status).toBe(404);
    expect((await put(id, { waypoints: drawn }, demoCookie)).status).toBe(403);
    const stale = await put(id, { waypoints: drawn, baseVersion: "2020-01-01T00:00:00.000Z" });
    expect(stale.status).toBe(409);
    expect((await row(id)).geometrySource).toBe("straight");
  });

  describe("a manual line is never overwritten", () => {
    it("by the single re-route, by the bulk re-route's replaceable set, nor by a save that changes the line name", async () => {
      const id = await ride();
      await put(id, { waypoints: drawn });
      mockResolve.mockResolvedValue({ id: "graphhopper", route });
      route.mockResolvedValue(wrongRoad);

      const again = await request(app).post(`/api/v1/bus/${id}/route`).set("Cookie", cookie);
      expect(again.body.meta.geometry.outcome).toBe("unchanged");
      const bulk = await routeStraightRide(userId, id, undefined, ["straight", "road"]);
      expect(bulk?.outcome).toBe("unchanged");
      const patched = await request(app)
        .patch(`/api/v1/bus/${id}`)
        .set("Cookie", cookie)
        .send({ lineName: "Line 2" });
      expect(patched.status).toBe(200);
      expect(route).not.toHaveBeenCalled();
      expect(await row(id)).toMatchObject({ geometrySource: "manual", geometry: drawn });
    });

    it("but moving a terminal drops it, the drawn ends no longer fit", async () => {
      const id = await ride();
      await put(id, { waypoints: drawn });
      const patched = await request(app)
        .patch(`/api/v1/bus/${id}`)
        .set("Cookie", cookie)
        .send({ departureStation: { ...dep, lat: dep.lat + 0.5 } });
      expect(patched.status).toBe(200);
      expect((await row(id)).geometrySource).not.toBe("manual");
    });
  });

  describe("DELETE", () => {
    it("drops the line and routes again; the router's answer is reported", async () => {
      const id = await ride();
      await put(id, { waypoints: drawn });
      mockResolve.mockResolvedValue({ id: "graphhopper", route });
      route.mockResolvedValue(wrongRoad);
      const res = await del(id);
      expect(res.status).toBe(200);
      expect(res.body.meta.busRoute).toBe("routed");
      expect(await row(id)).toMatchObject({ geometrySource: "road", distanceKm: 709 });
    });

    it("falls back to the chord, honestly reported, when no router answers", async () => {
      const id = await ride();
      await put(id, { waypoints: drawn });
      mockResolve.mockResolvedValue(null);
      const res = await del(id);
      expect(res.body.meta.busRoute).toBe("straight");
      expect(await row(id)).toMatchObject({
        geometrySource: "straight",
        geometry: null,
        distanceSource: "great_circle",
      });
    });

    it("is unchanged when there was no manual line, and refuses a stale version", async () => {
      const id = await ride();
      expect((await del(id)).body.meta.busRoute).toBe("unchanged");
      await put(id, { waypoints: drawn });
      const stale = await request(app)
        .delete(`/api/v1/bus/${id}/route-override`)
        .set("Cookie", cookie)
        .send({ baseVersion: "2020-01-01T00:00:00.000Z" });
      expect(stale.status).toBe(409);
      expect((await row(id)).geometrySource).toBe("manual");
      expect((await del(id, otherCookie)).status).toBe(404);
    });
  });
});
