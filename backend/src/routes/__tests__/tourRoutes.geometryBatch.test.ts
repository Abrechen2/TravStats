import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("POST /tours/geometry/batch", () => {
  let cookie: string;
  const routeIds: string[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourgeobatch" } });
    const u = await prisma.user.create({
      data: { username: "tourgeobatch", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
    const trip = await prisma.trip.create({ data: { userId: u.id, name: "T" } });
    for (let r = 0; r < 3; r++) {
      const route = await prisma.tripRoute.create({
        data: { userId: u.id, tripId: trip.id, name: `S${r}`, mode: "road" },
      });
      routeIds.push(route.id);
      const stops = [];
      for (let i = 0; i <= r + 1; i++) {
        stops.push(
          await prisma.tripStop.create({
            data: { tripId: trip.id, title: `${r}-${i}`, lat: 50 + r + i * 0.1, lon: 8 + i * 0.1 },
          })
        );
      }
      await request(app)
        .put(`/api/v1/trips/${trip.id}/routes/${route.id}/stops`)
        .set("Cookie", cookie)
        .send({ stopIds: stops.map((s) => s.id) });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourgeobatch" } });
    await prisma.$disconnect();
  });

  it("loads the legs of all routes with ONE query, not one per route (forgejo#342)", async () => {
    const spy = jest.spyOn(prisma.tripRouteLeg, "findMany");
    try {
      const res = await request(app)
        .post("/api/v1/tours/geometry/batch")
        .set("Cookie", cookie)
        .send({ ids: routeIds });
      expect(res.status).toBe(200);
      // route r has r+1 legs, each its own group
      routeIds.forEach((id, r) => {
        expect(res.body.data[id].features).toHaveLength(r + 1);
      });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
