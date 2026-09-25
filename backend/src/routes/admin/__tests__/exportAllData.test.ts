import request from "supertest";

import app from "../../../index";
import { prisma } from "../../../db";
import { generateToken } from "../../../utils/jwt";

/**
 * The admin JSON export claims every domain. Tours and roadtrips were not in
 * it — a trip exported its stops and nothing of the route drawn over them,
 * and a roadtrip or tour with no trip was missing entirely, stations and
 * recordings with it.
 */
describe("GET /admin/export/all-data", () => {
  const USERNAME = "exportalldata-admin";
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const admin = await prisma.user.create({
      data: { username: USERNAME, passwordHash: "x", isAdmin: true },
    });
    userId = admin.id;
    cookie = `auth_token=${generateToken(admin.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  it("carries a standalone roadtrip with its stations, legs and recordings", async () => {
    const route = await prisma.tripRoute.create({
      data: { userId, name: "Ohne Reise", mode: "road", kind: "roadtrip", vehicle: "campervan" },
    });
    await prisma.tripStop.create({
      data: {
        title: "Hirtshals",
        lat: 57.59,
        lon: 9.96,
        routeId: route.id,
        routeOrderIdx: 0,
        overnight: true,
      },
    });
    await prisma.tripRouteTrack.create({
      data: {
        routeId: route.id,
        source: "gpx",
        startedAt: new Date("2026-09-18T08:00:00Z"),
        endedAt: new Date("2026-09-18T12:00:00Z"),
        geometry: [
          [9.96, 57.59],
          [9.9, 57.6],
        ],
        pointCount: 2,
        distanceKm: 5,
        ascentM: 120,
      },
    });

    const res = await request(app).get("/api/v1/admin/export/all-data").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const body = typeof res.body === "object" && res.body.users ? res.body : JSON.parse(res.text);
    const me = body.users.find((u: { id: string }) => u.id === userId);
    expect(me.tourRoutes).toEqual([
      expect.objectContaining({
        name: "Ohne Reise",
        kind: "roadtrip",
        vehicle: "campervan",
        stops: [expect.objectContaining({ title: "Hirtshals", overnight: true })],
        legs: [],
        tracks: [expect.objectContaining({ source: "gpx", ascentM: 120 })],
      }),
    ]);
  });
});
