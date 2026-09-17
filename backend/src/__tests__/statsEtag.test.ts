import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";
import { computeStatsEtag, matchesIfNoneMatch } from "../middleware/statsEtag";

/**
 * Conditional GET on the statistics endpoints (forgejo#50).
 *
 * The 304 short-cut is only worth having if it can never hide a change. So the
 * tests that matter are the ones where the data moved but the COUNT did not:
 * an edited flight and an edited cruise stop. Before `flights.updated_at` and
 * `cruise_stops.updated_at` existed, nothing cheap could tell those apart from
 * an untouched account, and a fingerprint without them would have answered
 * "not modified" with the old numbers.
 */
const URL = "/api/v1/stats/summary";
const OWNER = `stats-etag-${Date.now()}`;
const OTHER = `stats-etag-other-${Date.now()}`;

describe("statistics ETag", () => {
  let userId: string;
  let otherId: string;
  let cookie: string;

  const get = (etag?: string): request.Test => {
    const req = request(app).get(URL).set("Cookie", cookie);
    return etag ? req.set("If-None-Match", etag) : req;
  };

  const createFlight = (flightNumber: string): Promise<{ id: string }> =>
    prisma.flight.create({
      data: {
        userId,
        airline: "Lufthansa",
        flightNumber,
        depIata: "FRA",
        depLat: 50.0379,
        depLon: 8.5622,
        arrIata: "JFK",
        arrLat: 40.6413,
        arrLon: -73.7781,
        departureTime: new Date(Date.UTC(2020, 0, 1, 8, 0)),
        arrivalTime: new Date(Date.UTC(2020, 0, 1, 16, 0)),
        status: "flown",
      },
      select: { id: true },
    });

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: OWNER, passwordHash } })).id;
    otherId = (await prisma.user.create({ data: { username: OTHER, passwordHash } })).id;
    cookie = `auth_token=${generateToken(userId)}`;
    await createFlight("LH400");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  it("answers with a private, revalidating weak ETag — never public, never shared", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.etag).toMatch(/^W\/".+"$/);
    expect(res.headers["cache-control"]).toBe("private, no-cache");
  });

  it("answers 304 with no body when nothing moved", async () => {
    const first = await get();
    const second = await get(first.headers.etag);
    expect(second.status).toBe(304);
    expect(second.text ?? "").toBe("");
  });

  it("sees a new flight", async () => {
    const before = (await get()).headers.etag;
    const flight = await createFlight("LH401");
    const after = await get(before);
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(before);
    await prisma.flight.delete({ where: { id: flight.id } });
  });

  it("sees a deleted flight", async () => {
    const flight = await createFlight("LH402");
    const before = (await get()).headers.etag;
    await prisma.flight.delete({ where: { id: flight.id } });
    expect((await get(before)).status).toBe(200);
  });

  it("sees an EDITED flight, where the row count does not change", async () => {
    const flight = await createFlight("LH403");
    const before = (await get()).headers.etag;
    // The stored timestamps have millisecond precision; make sure the edit
    // cannot land in the same millisecond as the insert.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await prisma.flight.update({ where: { id: flight.id }, data: { seatNumber: "12A" } });
    const after = await get(before);
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(before);
    await prisma.flight.delete({ where: { id: flight.id } });
  });

  it("sees an edited cruise stop", async () => {
    const port = await prisma.port.findFirst({ select: { id: true } });
    if (!port) throw new Error("port catalogue is empty — run scripts/seed-test-catalogues.ts");
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        status: "flown",
        startDate: new Date("2021-05-01"),
        endDate: new Date("2021-05-08"),
        departurePortId: port.id,
        arrivalPortId: port.id,
      },
      select: { id: true },
    });
    const stop = await prisma.cruiseStop.create({
      data: { cruiseId: cruise.id, portId: null, dayNumber: 1, isAtSea: true },
      select: { id: true },
    });
    const before = (await get()).headers.etag;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await prisma.cruiseStop.update({ where: { id: stop.id }, data: { dayNumber: 2 } });
    expect((await get(before)).status).toBe(200);
    await prisma.cruise.delete({ where: { id: cruise.id } });
  });

  it("does not move when ANOTHER user writes", async () => {
    const before = (await get()).headers.etag;
    await prisma.flight.create({
      data: {
        userId: otherId,
        airline: "Lufthansa",
        flightNumber: "LH999",
        depIata: "FRA",
        depLat: 50.0379,
        depLon: 8.5622,
        arrIata: "JFK",
        arrLat: 40.6413,
        arrLon: -73.7781,
        departureTime: new Date(Date.UTC(2020, 0, 1, 8, 0)),
        status: "flown",
      },
    });
    expect((await get(before)).status).toBe(304);
  });

  it("differs per user, per URL and per hour", async () => {
    const now = new Date("2026-09-16T10:30:00Z");
    const base = await computeStatsEtag(userId, URL, now);
    expect(await computeStatsEtag(otherId, URL, now)).not.toBe(base);
    expect(await computeStatsEtag(userId, "/api/v1/stats/fun", now)).not.toBe(base);
    expect(await computeStatsEtag(userId, URL, new Date("2026-09-16T10:59:59Z"))).toBe(base);
    expect(await computeStatsEtag(userId, URL, new Date("2026-09-16T11:00:00Z"))).not.toBe(base);
  });

  it("compares weakly, and honours lists and *", () => {
    expect(matchesIfNoneMatch('W/"abc"', 'W/"abc"')).toBe(true);
    expect(matchesIfNoneMatch('"abc"', 'W/"abc"')).toBe(true);
    expect(matchesIfNoneMatch('W/"x", W/"abc"', 'W/"abc"')).toBe(true);
    expect(matchesIfNoneMatch("*", 'W/"abc"')).toBe(true);
    expect(matchesIfNoneMatch('W/"abd"', 'W/"abc"')).toBe(false);
    expect(matchesIfNoneMatch(undefined, 'W/"abc"')).toBe(false);
  });
});
