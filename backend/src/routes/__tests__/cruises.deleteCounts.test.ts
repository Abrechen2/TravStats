/**
 * forgejo#250, review I1: a cruise carries how many GPS recordings and
 * hand-drawn route corrections it has — both cascade on delete, and the
 * delete question names them from these counts.
 */
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const USER = "cruisedeletecounts";

describe("a cruise's _count of tracks and drawn routes", () => {
  let cookie: string;
  let userId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.cruise.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("is on the detail read and on every list row", async () => {
    const cruise = await prisma.cruise.create({
      data: { userId, cruiseLine: "Testreederei", startDate: new Date("2026-07-01T00:00:00Z") },
    });
    await prisma.cruiseTrack.create({
      data: {
        cruiseId: cruise.id,
        source: "gpx",
        startedAt: new Date("2026-07-01T08:00:00Z"),
        endedAt: new Date("2026-07-01T17:00:00Z"),
        geometry: [],
        segmentStarts: [],
        cumulativeKm: [],
        pointCount: 0,
        distanceKm: 0,
      },
    });
    for (const toRef of ["2", "3"]) {
      await prisma.cruiseLegRoute.create({
        data: {
          cruiseId: cruise.id,
          fromKind: "port",
          fromRef: "1",
          toKind: "port",
          toRef,
          waypoints: [],
        },
      });
    }

    const detail = await request(app).get(`/api/v1/cruises/${cruise.id}`).set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data._count).toEqual({ tracks: 1, legRoutes: 2 });

    const list = await request(app).get("/api/v1/cruises").set("Cookie", cookie);
    const row = (list.body.data as Array<{ id: string; _count?: unknown }>).find(
      (c) => c.id === cruise.id
    );
    expect(row?._count).toEqual({ tracks: 1, legRoutes: 2 });
  });
});
