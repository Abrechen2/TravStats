import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Tour route sections — leg overrides", () => {
  let cookie: string;
  let userId: string;
  let tripId: string;
  let routeId: string;
  let fromId: string;
  let toId: string;

  const LINE: Array<[number, number]> = [
    [8.0, 58.15],
    [7.0, 59.2],
    [5.32, 60.39],
  ];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourlegs" } });
    const u = await prisma.user.create({
      data: { username: "tourlegs", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    const trip = await prisma.trip.create({ data: { userId, name: "T" } });
    tripId = trip.id;
    const route = await prisma.tripRoute.create({ data: { tripId, name: "S", mode: "road" } });
    routeId = route.id;

    const a = await prisma.tripStop.create({
      data: { tripId, title: "Kristiansand", lat: 58.15, lon: 8.0 },
    });
    const b = await prisma.tripStop.create({
      data: { tripId, title: "Bergen", lat: 60.39, lon: 5.32 },
    });
    fromId = a.id;
    toId = b.id;

    await request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/stops`)
      .set("Cookie", cookie)
      .send({ stopIds: [fromId, toId] });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourlegs" } });
    await prisma.$disconnect();
  });

  const url = (f = fromId, t = toId) =>
    `/api/v1/trips/${tripId}/routes/${routeId}/legs/${f}/${t}`;

  it("stores a drawn line and measures it", async () => {
    const before = await prisma.tripRouteLeg.findFirstOrThrow({ where: { routeId } });

    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "drawn", waypoints: LINE });

    expect(res.status).toBe(200);
    expect(res.body.leg.source).toBe("drawn");
    expect(res.body.leg.confidence).toBe("high");
    expect(res.body.leg.distanceKm).toBeGreaterThan(before.distanceKm);
  });

  it("rejects a line that does not start at the leg's first stop", async () => {
    const wrong: Array<[number, number]> = [
      [0, 0],
      [5.32, 60.39],
    ];
    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "drawn", waypoints: wrong });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/anchor|endpoint/i);
  });

  it("rejects a leg that is not part of this section", async () => {
    const stray = await prisma.tripStop.create({
      data: { tripId, title: "Stray", lat: 1, lon: 1 },
    });
    const res = await request(app)
      .put(url(fromId, stray.id))
      .set("Cookie", cookie)
      .send({ source: "drawn", waypoints: LINE });
    expect(res.status).toBe(404);
  });

  it("changes the transport mode of one leg", async () => {
    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "straight", mode: "ferry" });
    expect(res.status).toBe(200);
    expect(res.body.leg.mode).toBe("ferry");
  });

  it("DELETE drops the override and returns the leg to a straight chord", async () => {
    const straight = await prisma.tripRouteLeg.findFirstOrThrow({ where: { routeId } });
    await request(app).put(url()).set("Cookie", cookie).send({ source: "drawn", waypoints: LINE });

    const del = await request(app).delete(url()).set("Cookie", cookie);
    expect(del.status).toBe(204);

    const after = await prisma.tripRouteLeg.findFirstOrThrow({ where: { routeId } });
    expect(after.source).toBe("straight");
    expect(after.waypoints).toBeNull();
    expect(after.distanceKm).toBeCloseTo(straight.distanceKm, 6);
  });

  it("clears an optional field when the client sends null", async () => {
    await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "straight", tollCost: 12.5, currency: "EUR" });

    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "straight", tollCost: null });

    expect(res.status).toBe(200);
    expect(res.body.leg.tollCost).toBeNull();
    // currency was not mentioned this time, so it must survive untouched.
    expect(res.body.leg.currency).toBe("EUR");
  });

  it("leaves an optional field alone when the client omits it", async () => {
    await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "straight", drivingMinutes: 90 });

    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "straight" });

    expect(res.status).toBe(200);
    expect(res.body.leg.drivingMinutes).toBe(90);
  });
});
