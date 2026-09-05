import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#90 — the trip list's `_count` stopped at flights, cruises and
 * stays. A client that wanted to show "3 sections" beside each trip had to
 * call GET /trips/:id/routes once per trip: N trips, N+1 requests. The
 * count now rides in the same `_count` object, named after the relation.
 */
describe("the trip list counts tour sections in _count.routes", () => {
  let authCookie: string;
  let userId: string;
  let tripWithRoutes: string;
  let tripWithout: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripRouteCount" } });
    const user = await prisma.user.create({
      data: { username: "tripRouteCount", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;

    const withRoutes = await prisma.trip.create({
      data: { userId, name: "Road trip", status: "completed" },
    });
    tripWithRoutes = withRoutes.id;
    await prisma.tripRoute.createMany({
      data: [
        { tripId: tripWithRoutes, name: "Outbound", mode: "road", orderIdx: 0 },
        { tripId: tripWithRoutes, name: "Return", mode: "rail", orderIdx: 1 },
      ],
    });

    const without = await prisma.trip.create({
      data: { userId, name: "Flights only", status: "completed" },
    });
    tripWithout = without.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("reports two routes for a trip with two sections, alongside the other counts", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie);
    expect(res.status).toBe(200);

    const trip = res.body.trips.find((t: { id: string }) => t.id === tripWithRoutes);
    expect(trip).toBeDefined();
    expect(trip._count).toEqual({ flights: 0, cruises: 0, lodgingStays: 0, routes: 2 });
  });

  it("reports zero, not an absent key, for a trip without sections", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie);
    const trip = res.body.trips.find((t: { id: string }) => t.id === tripWithout);
    expect(trip._count.routes).toBe(0);
  });
});
