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
  /** The house that proves Slovenia and nothing else. See the test below. */
  let lodgingId = "";

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

    /**
     * A country proved ONLY by a house — the shape that used to 404 here.
     *
     * `Hotel Sport` is the live case: one house, no stay, a Google Place ID
     * saying Bucharest while its address says Otočec in Slovenia. It put a
     * country in the owner's passport and took a database session to find. The
     * owner's instruction (spec §3.4) is that such a record must be one click
     * from the row AND editable, which needs its id to travel.
     */
    const house = await prisma.lodging.create({
      data: {
        userId: user.id,
        name: "Hotel Sport",
        country: "Slovenia",
        isoCountryCode: "SI",
        visited: true,
      },
    });
    lodgingId = house.id;

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

  it("opens a country proved only by a house, and hands back its id", async () => {
    // Before this the union was flight | port | place, so the drill-down for
    // the single case the design was written about was empty by construction:
    // a lodging-only country answered 404 and the provenance the passport row
    // named could not be reached at all.
    if (!catalogReady) return;
    const res = await request(app).get("/api/v1/stats/countries/SI").set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe("SI");
    expect(res.body.evidence).toBe("lodging");
    expect(res.body.lodgings).toBe(1);
    expect(res.body.timeline).toEqual([
      { kind: "lodging", date: null, lodgingId, name: "Hotel Sport" },
    ]);
    // The existing honesty, unchanged: a house is not an airport and not a
    // flight, so the country reports neither.
    expect(res.body.entries).toBe(0);
    expect(res.body.airports).toEqual([]);
  });

  it("hands back an id that resolves to the real record, so the row can be edited", async () => {
    // The half of §3.4 a count cannot satisfy: `kinds: ["lodging"]` says what
    // sort of thing proved the country, never WHICH thing. An id that named no
    // row would turn a diagnosis into a dead end just as thoroughly as a 404.
    if (!catalogReady) return;
    const res = await request(app).get("/api/v1/stats/countries/SI").set("Cookie", authCookie);
    const named = res.body.timeline[0].lodgingId as string;

    const record = await prisma.lodging.findUnique({ where: { id: named } });
    expect(record).not.toBeNull();
    expect(record?.userId).toBe(user.id);
    expect(record?.name).toBe("Hotel Sport");
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
