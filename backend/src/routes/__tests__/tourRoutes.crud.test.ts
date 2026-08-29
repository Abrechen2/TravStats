import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Tour route sections — CRUD", () => {
  let cookie: string;
  let otherCookie: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tourcrud", "tourcrudother"] } } });

    const u = await prisma.user.create({
      data: { username: "tourcrud", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: "tourcrudother", passwordHash: await hashPassword("password123") },
    });
    otherCookie = `auth_token=${generateToken(other.id)}`;

    const trip = await prisma.trip.create({ data: { userId: u.id, name: "Norwegen 2024" } });
    tripId = trip.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tourcrud", "tourcrudother"] } } });
    await prisma.$disconnect();
  });

  it("creates a section and lists it with zero distance", async () => {
    const created = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", cookie)
      .send({ name: "Südnorwegen", mode: "road" });

    expect(created.status).toBe(201);
    expect(created.body.route).toMatchObject({ name: "Südnorwegen", mode: "road", stopCount: 0 });
    expect(created.body.route.distanceKm).toBe(0);

    const list = await request(app).get(`/api/v1/trips/${tripId}/routes`).set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.routes).toHaveLength(1);
  });

  it("rejects a section on someone else's trip with 404", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", otherCookie)
      .send({ name: "Fremd", mode: "road" });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid mode with 400", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", cookie)
      .send({ name: "X", mode: "hotel" });
    expect(res.status).toBe(400);
  });

  it("renames a section", async () => {
    const created = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", cookie)
      .send({ name: "Alt", mode: "foot" });
    const id = created.body.route.id as string;

    const patched = await request(app)
      .patch(`/api/v1/trips/${tripId}/routes/${id}`)
      .set("Cookie", cookie)
      .send({ name: "Besseggen" });

    expect(patched.status).toBe(200);
    expect(patched.body.route.name).toBe("Besseggen");
  });

  it("deleting a section releases its stops instead of deleting them", async () => {
    const created = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", cookie)
      .send({ name: "Wegwerf", mode: "road" });
    const routeId = created.body.route.id as string;

    const stop = await prisma.tripStop.create({
      data: { tripId, title: "Bergen", lat: 60.39, lon: 5.32, routeId, routeOrderIdx: 0 },
    });

    const del = await request(app)
      .delete(`/api/v1/trips/${tripId}/routes/${routeId}`)
      .set("Cookie", cookie);
    expect(del.status).toBe(204);

    const survivor = await prisma.tripStop.findUnique({ where: { id: stop.id } });
    expect(survivor).not.toBeNull();
    expect(survivor?.routeId).toBeNull();
    expect(survivor?.routeOrderIdx).toBeNull();
  });

  describe("GET /trips/:id/routes/:routeId", () => {
    it("returns the section with its stops and legs, and never modifies anything", async () => {
      const created = await request(app)
        .post(`/api/v1/trips/${tripId}/routes`)
        .set("Cookie", cookie)
        .send({ name: "Fjordrunde", mode: "road" });
      const routeId = created.body.route.id as string;

      const stopA = await prisma.tripStop.create({
        data: { tripId, title: "Kristiansand", lat: 58.15, lon: 8.0, routeId, routeOrderIdx: 0 },
      });
      const stopB = await prisma.tripStop.create({
        data: { tripId, title: "Bergen", lat: 60.39, lon: 5.32, routeId, routeOrderIdx: 1 },
      });
      await prisma.tripRouteLeg.create({
        data: {
          routeId,
          fromStopId: stopA.id,
          toStopId: stopB.id,
          distanceKm: 305.4,
          source: "straight",
          mode: "road",
          confidence: "low",
        },
      });

      // Capture the stops' `updatedAt` BEFORE the read — the whole point of
      // this endpoint (fix round 1) is that a GET must never take a write
      // lock or bump a row, the way re-sending the stop order through
      // `PUT .../stops` as a no-op refresh used to.
      const before = await prisma.tripStop.findMany({
        where: { routeId },
        orderBy: { routeOrderIdx: "asc" },
        select: { id: true, updatedAt: true },
      });

      const res = await request(app)
        .get(`/api/v1/trips/${tripId}/routes/${routeId}`)
        .set("Cookie", cookie);

      expect(res.status).toBe(200);
      expect(res.body.route).toMatchObject({ id: routeId, name: "Fjordrunde", stopCount: 2 });
      expect(res.body.stops).toHaveLength(2);
      expect(res.body.stops.map((s: { id: string }) => s.id)).toEqual([stopA.id, stopB.id]);
      expect(res.body.legs).toHaveLength(1);
      expect(res.body.legs[0]).toMatchObject({
        fromStopId: stopA.id,
        toStopId: stopB.id,
        distanceKm: 305.4,
        source: "straight",
        mode: "road",
      });

      const after = await prisma.tripStop.findMany({
        where: { routeId },
        orderBy: { routeOrderIdx: "asc" },
        select: { id: true, updatedAt: true },
      });
      expect(after).toEqual(before);
    });

    it("rejects a read on someone else's trip with 404", async () => {
      const created = await request(app)
        .post(`/api/v1/trips/${tripId}/routes`)
        .set("Cookie", cookie)
        .send({ name: "Privat", mode: "road" });
      const routeId = created.body.route.id as string;

      const res = await request(app)
        .get(`/api/v1/trips/${tripId}/routes/${routeId}`)
        .set("Cookie", otherCookie);
      expect(res.status).toBe(404);
    });
  });

  describe("auth middleware placement (regression)", () => {
    // `tourRoutes.ts` and `tourLegs.ts` are mounted at the wide `/api/v1`
    // base (see mounts.ts), not a narrow sub-path like `/api/v1/cruises`.
    // Express runs a router's `router.use(...)` middleware for EVERY
    // request that reaches that router, not only for requests matching one
    // of its own routes. A router-level `router.use(authenticate)` here
    // therefore intercepted every request to any endpoint mounted AFTER
    // these two routers under `/api/v1` — e.g. `pairing.ts` — and rejected
    // it with 401 before it ever reached its own router. The fix moved
    // `authenticate`/`requireWriteScope` to per-route middleware, matching
    // the convention `routes/trips.ts` already uses.
    it("does not intercept a public endpoint mounted after it", async () => {
      // POST /api/v1/pairing/claim is deliberately public (rate-limited,
      // no `authenticate` at all — see pairing.ts) so the mobile app can
      // exchange a pairing code before it has any credentials. An invalid
      // code must fail with 400 ("Invalid or expired pairing code"), never
      // 401 — a 401 here would mean a tour router swallowed the request.
      const res = await request(app)
        .post("/api/v1/pairing/claim")
        .send({ code: "000000", deviceName: "test-device" });

      expect(res.status).not.toBe(401);
      expect(res.status).toBe(400);
    });

    it("still requires authentication on the tour endpoints themselves", async () => {
      // The other half of the fix: moving auth from router.use(...) to
      // per-route middleware must not have dropped it anywhere. An
      // unauthenticated request to a tour endpoint must still be 401.
      const res = await request(app).get(`/api/v1/trips/${tripId}/routes`);
      expect(res.status).toBe(401);
    });
  });
});
