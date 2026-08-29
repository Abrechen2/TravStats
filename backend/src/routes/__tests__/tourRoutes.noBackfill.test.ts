import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A trip that pre-dates route sections must report ZERO kilometres and hold
 * ZERO route rows, no matter how route-like its stops look.
 *
 * This is the design's central promise: route membership is explicit, never
 * derived. A future "helpful" backfill — matching by date, by proximity, by
 * `domain === "road"` — would invent travel history the user never entered,
 * and it would land in the statistics. This test is what stops it.
 */
describe("no fabricated history", () => {
  let cookie: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "nobackfill" } });
    const u = await prisma.user.create({
      data: { username: "nobackfill", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;

    const trip = await prisma.trip.create({ data: { userId: u.id, name: "Alte Reise" } });
    tripId = trip.id;

    // Deliberately route-shaped: ordered, dated, coordinate-bearing, and
    // carrying the very `domain` labels a heuristic would latch onto.
    const legacy: Array<[string, string, number, number]> = [
      ["Osnabrück", "road", 52.28, 8.05],
      ["Hamburg", "road", 53.55, 9.99],
      ["Hirtshals", "ferry", 57.59, 9.96],
      ["Bergen", "hotel", 60.39, 5.32],
    ];
    for (const [title, domain, lat, lon] of legacy) {
      await prisma.tripStop.create({ data: { tripId, title, domain, lat, lon } });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "nobackfill" } });
    await prisma.$disconnect();
  });

  it("holds no route sections", async () => {
    const res = await request(app).get(`/api/v1/trips/${tripId}/routes`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.routes).toEqual([]);
  });

  it("leaves every stop unassigned", async () => {
    const assigned = await prisma.tripStop.count({ where: { tripId, routeId: { not: null } } });
    expect(assigned).toBe(0);
  });

  it("has no legs anywhere for this trip", async () => {
    const legs = await prisma.tripRouteLeg.count({ where: { route: { tripId } } });
    expect(legs).toBe(0);
  });
});
