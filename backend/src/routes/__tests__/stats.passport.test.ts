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

/**
 * A house reaches the passport — spec §1.2, the clearest of the four counting
 * bugs and the one only a live request can prove is wired at all: the
 * derivation is a pure function, so a unit test passes happily while the
 * endpoint still fetches no lodging.
 *
 * A separate account on purpose. Adding a house to the fixture above would
 * change numbers those tests assert for reasons that have nothing to do with
 * what they pin.
 */
describe("GET /api/v1/stats/passport — lodging", () => {
  let user: { id: string };
  let authCookie: string;

  beforeAll(async () => {
    const stamp = Date.now();
    user = await prisma.user.create({
      data: {
        username: `passport-lodger-${stamp}`,
        passwordHash: await hashPassword("test-password"),
        isActive: true,
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;

    // Reached by car, slept in, never flown to: invisible to this endpoint
    // until lodging became evidence. No stay at all — the owner's decision of
    // 2026-09-02, and the shape five of his countries actually have.
    await prisma.lodging.create({
      data: {
        userId: user.id,
        name: "Penzion u lesa",
        country: "Česko",
        isoCountryCode: "CZ",
        visited: true,
      },
    });

    // A house the user only bookmarked. `visited: false` is a saved-places
    // import, not a night anywhere, and it must not become a country.
    await prisma.lodging.create({
      data: {
        userId: user.id,
        name: "Someday Resort",
        country: "Maldives",
        isoCountryCode: "MV",
        visited: false,
      },
    });

    // A booking still ahead. Looks like the first house and is its opposite.
    const future = await prisma.lodging.create({
      data: {
        userId: user.id,
        name: "Hotel Bucuresti",
        country: "România",
        isoCountryCode: "RO",
        visited: true,
      },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: user.id,
        lodgingId: future.id,
        checkIn: new Date("2099-12-20T00:00:00Z"),
        checkOut: new Date("2099-12-27T00:00:00Z"),
        status: "scheduled",
      },
    });

    // A trip that was called off. The dates are long past, so `checkOut` alone
    // reads it as a night slept — which is why the endpoint has to fetch the
    // STATUS as well. Filtering the stay out of the query instead would leave a
    // house with no stay at all, and that counts as a night.
    const cancelled = await prisma.lodging.create({
      data: {
        userId: user.id,
        name: "Hôtel Annulé",
        country: "France",
        isoCountryCode: "FR",
        visited: true,
      },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: user.id,
        lodgingId: cancelled.id,
        checkIn: new Date("2024-05-01T00:00:00Z"),
        checkOut: new Date("2024-05-04T00:00:00Z"),
        status: "cancelled",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: user.id } }).catch(() => {});
  });

  it("counts a country proved only by a house, and adds no airport for it", async () => {
    const res = await request(app).get("/api/v1/stats/passport").set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.countries).toHaveLength(1);
    expect(res.body.countries[0]).toMatchObject({
      code: "CZ",
      tier: "slept",
      kinds: ["lodging"],
      hasUndatedEvidence: true,
      entries: 0,
      airports: [],
    });
    expect(res.body.summary.countries).toBe(1);
    // A house is not an airport and not a flight. Both figures count exactly
    // what they always counted.
    expect(res.body.summary.airports).toBe(0);
    expect(res.body.summary.entries).toBe(0);
  });

  it("leaves out a bookmarked house and a booking still to come", async () => {
    const res = await request(app).get("/api/v1/stats/passport").set("Cookie", authCookie);

    const codes = res.body.countries.map((c: { code: string }) => c.code);
    expect(codes).not.toContain("MV");
    expect(codes).not.toContain("RO");
  });

  it("leaves out a house whose only stay was cancelled, past dates and all", async () => {
    // Only a live request can prove this one: the derivation is a pure function
    // and passes happily while the endpoint selects `checkOut` without `status`,
    // in which case a called-off booking from 2024 reads as a night in France.
    const res = await request(app).get("/api/v1/stats/passport").set("Cookie", authCookie);

    expect(res.body.countries.map((c: { code: string }) => c.code)).not.toContain("FR");
    expect(res.body.summary.countries).toBe(1);
  });
});
