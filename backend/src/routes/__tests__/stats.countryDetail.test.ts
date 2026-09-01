import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The country page and the year in review, over a real database.
 *
 * The derivations are covered by unit tests; what only a live request can get
 * wrong is here — that each airport's country comes from the catalogue, that
 * `/countries/:code` does not swallow the `/countries` list route mounted after
 * it, and that neither endpoint answers with somebody else's travel.
 */
describe("GET /api/v1/stats/countries/:code and /wrapped", () => {
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
          username: `country-owner-${stamp}`,
          passwordHash: await hashPassword("test-password"),
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          username: `country-stranger-${stamp}`,
          passwordHash: await hashPassword("test-password"),
          isActive: true,
        },
      }),
    ]);
    authCookie = `auth_token=${generateToken(user.id)}`;

    await prisma.flight.create({
      data: {
        userId: user.id,
        flightNumber: "LH410",
        airline: "Lufthansa",
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
    await prisma.user.deleteMany({ where: { id: { in: [user.id, stranger.id] } } }).catch(() => {});
  });

  it("resolves the country from the catalogue and reports its airports", async () => {
    if (!catalogReady) return;
    const res = await request(app).get("/api/v1/stats/countries/DE").set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("DE");
    expect(res.body.entries).toBe(1);
    expect(res.body.evidence).toBe("flight");
    expect(res.body.airports.map((a: { iata: string }) => a.iata)).toEqual(["MUC"]);
    expect(res.body.timeline[0]).toMatchObject({ kind: "flight", airportIata: "MUC" });
  });

  it("does not swallow the /countries list route mounted after it", async () => {
    // `/countries/:code` is registered first, so an Express change that made it
    // match a bare `/countries` would silently break the list the stats page
    // draws. Cheap to pin, invisible until a user opens the page.
    if (!catalogReady) return;
    const res = await request(app).get("/api/v1/stats/countries").set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.countries)).toBe(true);
  });

  it("answers 404 for a country the caller has no record of", async () => {
    if (!catalogReady) return;
    // Japan is the STRANGER's country. A 200 here would be a leak.
    const res = await request(app).get("/api/v1/stats/countries/JP").set("Cookie", authCookie);
    expect(res.status).toBe(404);
  });

  it("rejects a country parameter that cannot be one", async () => {
    if (!catalogReady) return;
    const res = await request(app).get("/api/v1/stats/countries/x").set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  it("tells the year's story from the caller's own travel", async () => {
    if (!catalogReady) return;
    const res = await request(app).get("/api/v1/stats/wrapped").set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2019);
    expect(res.body.availableYears).toEqual([2019]);
    expect(res.body.flights).toBe(1);
    expect(res.body.topAirline).toEqual({ name: "Lufthansa", code: "LH", flights: 1 });
    expect(res.body.topRoute).toEqual({ from: "JFK", to: "MUC", flights: 1 });
    // Both countries were first reached in 2019, and the passport is where that
    // number comes from.
    expect(res.body.newCountries).toBe(2);
  });

  it("honours ?year= and reports an empty year honestly", async () => {
    if (!catalogReady) return;
    const res = await request(app).get("/api/v1/stats/wrapped?year=2015").set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2015);
    expect(res.body.flights).toBe(0);
    expect(res.body.topAirline).toBeNull();
  });

  it("rejects a year that is not one", async () => {
    if (!catalogReady) return;
    const res = await request(app)
      .get("/api/v1/stats/wrapped?year=nineteen")
      .set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  it("refuses an unauthenticated caller", async () => {
    const [country, wrapped] = await Promise.all([
      request(app).get("/api/v1/stats/countries/DE"),
      request(app).get("/api/v1/stats/wrapped"),
    ]);
    expect(country.status).toBe(401);
    expect(wrapped.status).toBe(401);
  });
});
