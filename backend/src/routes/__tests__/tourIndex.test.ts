import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Dashboard-wide tour endpoints (`routes/trips/tourIndex.ts`):
 * `GET /tours` (every tour section the caller owns, across all trips) and
 * `POST /tours/geometry/batch` (their geometry, one round trip). Mirrors
 * `cruises.ts`'s `geometry/batch` in shape and in how a foreign id is
 * handled — see the "foreign id" test below.
 */
describe("Tour dashboard index", () => {
  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let tripAId: string;
  let tripBId: string;
  let routeAId: string;
  let routeBId: string;
  let otherRouteId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tourindex", "tourindexother"] } } });

    const u = await prisma.user.create({
      data: { username: "tourindex", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: "tourindexother", passwordHash: await hashPassword("password123") },
    });
    otherCookie = `auth_token=${generateToken(other.id)}`;

    // Trip A / Route A — one real leg with coordinates, so distanceKm > 0
    // and the geometry batch has something to return.
    const tripA = await prisma.trip.create({ data: { userId, name: "Norwegen 2024" } });
    tripAId = tripA.id;
    const routeA = await prisma.tripRoute.create({
      data: { tripId: tripAId, name: "Süd-Norwegen", mode: "road" },
    });
    routeAId = routeA.id;
    const a1 = await prisma.tripStop.create({
      data: {
        tripId: tripAId,
        title: "Kristiansand",
        lat: 58.15,
        lon: 8.0,
        startDate: new Date("2024-07-01T00:00:00Z"),
      },
    });
    const a2 = await prisma.tripStop.create({
      data: {
        tripId: tripAId,
        title: "Bergen",
        lat: 60.39,
        lon: 5.32,
        endDate: new Date("2024-07-05T00:00:00Z"),
      },
    });
    await request(app)
      .put(`/api/v1/trips/${tripAId}/routes/${routeAId}/stops`)
      .set("Cookie", cookie)
      .send({ stopIds: [a1.id, a2.id] });

    // Trip B / Route B — a SECOND trip, so the list proves it spans trips,
    // not just sections within one.
    const tripB = await prisma.trip.create({ data: { userId, name: "Alpenquerung" } });
    tripBId = tripB.id;
    const routeB = await prisma.tripRoute.create({
      data: { tripId: tripBId, name: "Alpen", mode: "bike" },
    });
    routeBId = routeB.id;

    // Another user's trip/route — must never surface for `cookie`.
    const tripOther = await prisma.trip.create({ data: { userId: other.id, name: "Fremd" } });
    const routeOther = await prisma.tripRoute.create({
      data: { tripId: tripOther.id, name: "Fremde Route", mode: "road" },
    });
    otherRouteId = routeOther.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tourindex", "tourindexother"] } } });
    await prisma.$disconnect();
  });

  describe("GET /tours", () => {
    it("returns tours from several different trips of the caller", async () => {
      const res = await request(app).get("/api/v1/tours").set("Cookie", cookie);

      expect(res.status).toBe(200);
      const ids = res.body.tours.map((t: { id: string }) => t.id);
      expect(ids).toEqual(expect.arrayContaining([routeAId, routeBId]));
      const tripIds = new Set(res.body.tours.map((t: { tripId: string }) => t.tripId));
      expect(tripIds).toEqual(new Set([tripAId, tripBId]));

      const routeA = res.body.tours.find((t: { id: string }) => t.id === routeAId);
      expect(routeA).toMatchObject({
        id: routeAId,
        tripId: tripAId,
        tripName: "Norwegen 2024",
        name: "Süd-Norwegen",
        mode: "road",
        stopCount: 2,
      });
      expect(routeA.distanceKm).toBeGreaterThan(0);
      expect(routeA.startDate).toBe("2024-07-01T00:00:00.000Z");
      expect(routeA.endDate).toBe("2024-07-05T00:00:00.000Z");
    });

    it("never returns another user's tour", async () => {
      const res = await request(app).get("/api/v1/tours").set("Cookie", cookie);

      expect(res.status).toBe(200);
      const ids = res.body.tours.map((t: { id: string }) => t.id);
      expect(ids).not.toContain(otherRouteId);
    });

    it("carries no geometry — the key must be ABSENT, not empty", async () => {
      const res = await request(app).get("/api/v1/tours").set("Cookie", cookie);

      expect(res.status).toBe(200);
      for (const tour of res.body.tours) {
        expect(tour).not.toHaveProperty("geometry");
        expect(tour).not.toHaveProperty("waypoints");
      }
    });

    it("rejects an unauthenticated caller", async () => {
      const res = await request(app).get("/api/v1/tours");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /tours/geometry/batch", () => {
    it("returns geometry keyed by route id", async () => {
      const res = await request(app)
        .post("/api/v1/tours/geometry/batch")
        .set("Cookie", cookie)
        .send({ ids: [routeAId, routeBId] });

      expect(res.status).toBe(200);
      expect(res.body.data[routeAId].type).toBe("FeatureCollection");
      expect(res.body.data[routeAId].features).toHaveLength(1);
      expect(res.body.data[routeAId].features[0].geometry.type).toBe("LineString");
      // Route B has no stops assigned yet — a real section with zero legs.
      expect(res.body.data[routeBId]).toEqual({ type: "FeatureCollection", features: [] });
    });

    it("treats a foreign id exactly like the cruise batch — omitted, not a failure", async () => {
      const res = await request(app)
        .post("/api/v1/tours/geometry/batch")
        .set("Cookie", cookie)
        .send({ ids: [routeAId, otherRouteId] });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty(routeAId);
      expect(res.body.data).not.toHaveProperty(otherRouteId);
    });

    it("rejects more than 100 ids with 400", async () => {
      const ids = Array.from({ length: 101 }, () => routeAId);
      const res = await request(app)
        .post("/api/v1/tours/geometry/batch")
        .set("Cookie", cookie)
        .send({ ids });
      expect(res.status).toBe(400);
    });

    it("rejects an empty array with 400", async () => {
      const res = await request(app)
        .post("/api/v1/tours/geometry/batch")
        .set("Cookie", cookie)
        .send({ ids: [] });
      expect(res.status).toBe(400);
    });

    it("rejects an unauthenticated caller", async () => {
      const res = await request(app)
        .post("/api/v1/tours/geometry/batch")
        .send({ ids: [routeAId] });
      expect(res.status).toBe(401);
    });
  });
});
