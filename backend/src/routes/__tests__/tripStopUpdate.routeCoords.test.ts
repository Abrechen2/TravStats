import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * PATCH /trips/:id/stops/:stopId used to accept an explicit `lat`/`lon`
 * null on a stop that is currently a route member — `updateStopSchema`
 * allows nulling both, and the stop editor really does send that. The
 * result was silent: `GET .../geometry` then drops that leg from the
 * FeatureCollection while its `distanceKm` still counts in the section
 * total. This suite pins the 400 refusal that closes that gap.
 */
describe("PATCH /trips/:id/stops/:stopId refuses to null a route member's coordinates", () => {
  let cookie: string;
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourstopcoords" } });
    const u = await prisma.user.create({
      data: { username: "tourstopcoords", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen" } });
    tripId = trip.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourstopcoords" } });
    await prisma.$disconnect();
  });

  it("rejects lat:null on an assigned route stop with 400", async () => {
    const route = await prisma.tripRoute.create({
      data: { tripId, name: "Südnorwegen", mode: "road" },
    });
    const stop = await prisma.tripStop.create({
      data: {
        tripId,
        title: "Bergen",
        lat: 60.39,
        lon: 5.32,
        routeId: route.id,
        routeOrderIdx: 0,
      },
    });

    const res = await request(app)
      .patch(`/api/v1/trips/${tripId}/stops/${stop.id}`)
      .set("Cookie", cookie)
      .send({ lat: null });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/route/i);

    const unchanged = await prisma.tripStop.findUnique({ where: { id: stop.id } });
    expect(unchanged?.lat).toBe(60.39);
  });

  it("rejects lon:null on an assigned route stop with 400", async () => {
    const route = await prisma.tripRoute.create({
      data: { tripId, name: "Südnorwegen", mode: "road" },
    });
    const stop = await prisma.tripStop.create({
      data: {
        tripId,
        title: "Bergen",
        lat: 60.39,
        lon: 5.32,
        routeId: route.id,
        routeOrderIdx: 0,
      },
    });

    const res = await request(app)
      .patch(`/api/v1/trips/${tripId}/stops/${stop.id}`)
      .set("Cookie", cookie)
      .send({ lon: null });

    expect(res.status).toBe(400);
  });

  it("allows lat:null on a stop that is NOT a route member", async () => {
    const stop = await prisma.tripStop.create({
      data: { tripId, title: "Restaurant", lat: 60.39, lon: 5.32 },
    });

    const res = await request(app)
      .patch(`/api/v1/trips/${tripId}/stops/${stop.id}`)
      .set("Cookie", cookie)
      .send({ lat: null });

    expect(res.status).toBe(200);
    expect(res.body.stop.lat).toBeNull();
  });
});
