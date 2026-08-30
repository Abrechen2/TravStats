import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The passport endpoint over a real database.
 *
 * The derivation itself is covered by unit tests; what this pins is the part
 * only a live request can get wrong — that the country of each airport is
 * actually resolved from the catalogue, and that the endpoint is scoped to the
 * caller. A passport that leaked another account's countries would be a
 * particularly unpleasant bug to ship.
 */
describe("GET /api/v1/stats/passport", () => {
  let user: { id: string };
  let stranger: { id: string };
  let authCookie: string;
  let catalogReady = false;

  beforeAll(async () => {
    const [muc, jfk] = await Promise.all([
      prisma.airport.findFirst({ where: { iata: "MUC" } }),
      prisma.airport.findFirst({ where: { iata: "JFK" } }),
    ]);
    catalogReady = Boolean(muc?.country && jfk?.country);
    if (!catalogReady) return;

    const stamp = Date.now();
    [user, stranger] = await Promise.all([
      prisma.user.create({
        data: {
          username: `passport-owner-${stamp}`,
          passwordHash: await hashPassword("test-password"),
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          username: `passport-stranger-${stamp}`,
          passwordHash: await hashPassword("test-password"),
          isActive: true,
        },
      }),
    ]);
    authCookie = `auth_token=${generateToken(user.id)}`;

    await prisma.flight.create({
      data: {
        userId: user.id,
        depIata: "MUC",
        depLat: 48.3538,
        depLon: 11.7861,
        arrIata: "JFK",
        arrLat: 40.6413,
        arrLon: -73.7781,
        departureTime: new Date("2019-03-02T09:00:00Z"),
        status: "flown",
      },
    });

    // A different account's flight to a country the owner has never been to.
    await prisma.flight.create({
      data: {
        userId: stranger.id,
        depIata: "NRT",
        depLat: 35.7647,
        depLon: 140.3863,
        arrIata: "MUC",
        arrLat: 48.3538,
        arrLon: 11.7861,
        departureTime: new Date("2020-01-01T09:00:00Z"),
        status: "flown",
      },
    });
  });

  afterAll(async () => {
    if (!catalogReady) return;
    await prisma.user
      .deleteMany({ where: { id: { in: [user.id, stranger.id] } } })
      .catch(() => {});
  });

  it("resolves each airport's country from the catalogue", async () => {
    if (!catalogReady) return;
    const res = await request(app).get("/api/v1/stats/passport").set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.countries.map((c: { code: string }) => c.code).sort()).toEqual(["DE", "US"]);
    expect(res.body.summary.countries).toBe(2);
    expect(res.body.summary.airports).toBe(2);
    expect(res.body.summary.firstStampYear).toBe(2019);
  });

  it("shows only the caller's own travel", async () => {
    if (!catalogReady) return;
    const res = await request(app).get("/api/v1/stats/passport").set("Cookie", authCookie);

    expect(res.body.countries.map((c: { code: string }) => c.code)).not.toContain("JP");
    expect(res.body.stamps.map((s: { iata: string }) => s.iata)).not.toContain("NRT");
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await request(app).get("/api/v1/stats/passport");
    expect(res.status).toBe(401);
  });
});
