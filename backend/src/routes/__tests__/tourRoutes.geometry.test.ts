import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Tour route sections — geometry", () => {
  let cookie: string;
  let tripId: string;
  let routeId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourgeo" } });
    const u = await prisma.user.create({
      data: { username: "tourgeo", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;

    const trip = await prisma.trip.create({ data: { userId: u.id, name: "T" } });
    tripId = trip.id;
    const route = await prisma.tripRoute.create({ data: { tripId, name: "S", mode: "road" } });
    routeId = route.id;

    const a = await prisma.tripStop.create({ data: { tripId, title: "A", lat: 58.15, lon: 8.0 } });
    const b = await prisma.tripStop.create({ data: { tripId, title: "B", lat: 60.39, lon: 5.32 } });
    await request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/stops`)
      .set("Cookie", cookie)
      .send({ stopIds: [a.id, b.id] });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourgeo" } });
    await prisma.$disconnect();
  });

  it("returns a LineString per leg, chord for a straight leg", async () => {
    const res = await request(app)
      .get(`/api/v1/trips/${tripId}/routes/${routeId}/geometry`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(1);

    const f = res.body.features[0];
    expect(f.geometry.type).toBe("LineString");
    expect(f.geometry.coordinates).toEqual([
      [8.0, 58.15],
      [5.32, 60.39],
    ]);
    expect(f.properties.source).toBe("straight");
    expect(f.properties.mode).toBe("road");
  });

  it("returns an empty collection for a section with no stops", async () => {
    const empty = await prisma.tripRoute.create({ data: { tripId, name: "Leer", mode: "foot" } });
    const res = await request(app)
      .get(`/api/v1/trips/${tripId}/routes/${empty.id}/geometry`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.features).toEqual([]);
  });
});
