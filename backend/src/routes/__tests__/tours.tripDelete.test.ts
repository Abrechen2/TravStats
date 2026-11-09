import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * tours-own-domain T1: a tour is a domain of its own, so deleting the trip it
 * sat on never takes it along — also when it was drawn over the trip's
 * timeline stops (it used to cascade away with its geometry and legs).
 */
describe("deleting a trip keeps its tours", () => {
  const username = "tours-trip-delete";
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    userId = (
      await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  it("keeps a tour drawn over the trip's timeline: stops, legs and geometry, detached", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Mit Tour" } });
    const tour = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Wanderung", mode: "foot", kind: "tour" },
    });
    const a = await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        title: "Start",
        lat: 58,
        lon: 6,
        domain: "poi",
        routeId: tour.id,
        routeOrderIdx: 0,
      },
    });
    const b = await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        title: "Ziel",
        lat: 58.1,
        lon: 6.1,
        routeId: tour.id,
        routeOrderIdx: 1,
      },
    });
    await prisma.tripRouteLeg.create({
      data: {
        routeId: tour.id,
        fromStopId: a.id,
        toStopId: b.id,
        distanceKm: 12.5,
        source: "drawn",
        mode: "foot",
        waypoints: [
          [6, 58],
          [6.1, 58.1],
        ],
      },
    });

    const res = await request(app).delete(`/api/v1/trips/${trip.id}`).set("Cookie", cookie);
    expect(res.status).toBe(204);

    const kept = await prisma.tripRoute.findUnique({
      where: { id: tour.id },
      include: { stops: { orderBy: { routeOrderIdx: "asc" } }, legs: true },
    });
    expect(kept).toMatchObject({ tripId: null, kind: "tour" });
    expect(kept?.stops.map((s) => [s.title, s.tripId, s.domain])).toEqual([
      ["Start", null, "tour"],
      ["Ziel", null, "tour"],
    ]);
    expect(kept?.legs).toHaveLength(1);
    expect(kept?.legs[0]).toMatchObject({ distanceKm: 12.5, source: "drawn" });

    // Still listed, still standalone, with its geometry reachable.
    const list = await request(app).get("/api/v1/tours").set("Cookie", cookie);
    const mine = list.body.tours.find((t: { id: string }) => t.id === tour.id);
    expect(mine).toMatchObject({ tripId: null });
  });

  it("keeps a tour whose points are all its own, as before", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Eigene Punkte" } });
    const tour = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Eigen", mode: "foot", kind: "tour" },
    });
    await prisma.tripStop.create({
      data: { title: "Punkt", lat: 1, lon: 1, routeId: tour.id, routeOrderIdx: 0 },
    });
    await request(app).delete(`/api/v1/trips/${trip.id}`).set("Cookie", cookie).expect(204);
    expect(await prisma.tripRoute.findUnique({ where: { id: tour.id } })).toMatchObject({
      tripId: null,
    });
  });

  it("leaves another trip's tour alone", async () => {
    const other = await prisma.trip.create({ data: { userId, name: "Andere" } });
    const tour = await prisma.tripRoute.create({
      data: { userId, tripId: other.id, name: "Bleibt dran", mode: "foot", kind: "tour" },
    });
    const gone = await prisma.trip.create({ data: { userId, name: "Weg" } });
    await request(app).delete(`/api/v1/trips/${gone.id}`).set("Cookie", cookie).expect(204);
    expect(await prisma.tripRoute.findUnique({ where: { id: tour.id } })).toMatchObject({
      tripId: other.id,
    });
  });
});
