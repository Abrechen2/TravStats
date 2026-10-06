import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { FLIGHT_TRACK_MAX_BODY_BYTES, FLIGHT_TRACK_MAX_POINTS } from "../../schemas/flightDevice";

/**
 * The phone's recording of a flight (forgejo#193): stored in its own table,
 * idempotent per upload id, never displaced silently, refused for a flight
 * that is not the caller's or a span that is not the flight's.
 *
 * The recording runs due east along 50°N from 08:00Z, one point a minute,
 * 0.2° (~14 km) per step — a fast, sparse but unbroken line.
 */

const DEPARTURE = Date.parse("2026-10-03T08:00:00Z");

function points(count: number, opts: { from?: number; jumpAt?: number } = {}) {
  const from = opts.from ?? DEPARTURE;
  return Array.from({ length: count }, (_, i) => ({
    t: from + i * 60_000,
    lat: 50,
    // A 6° jump (~430 km) at `jumpAt` is a stretch without a fix.
    lon: 8 + i * 0.2 + (opts.jumpAt !== undefined && i >= opts.jumpAt ? 6 : 0),
    alt: 10_000,
    speed: 240,
  }));
}

describe("Flight recordings — /flights/:id/track", () => {
  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let otherUserId: string;
  let flightId: string;
  let otherFlightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["fltrack", "fltrackother"] } } });
    const u = await prisma.user.create({
      data: { username: "fltrack", passwordHash: await hashPassword("password123") },
    });
    const o = await prisma.user.create({
      data: { username: "fltrackother", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    otherUserId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    otherCookie = `auth_token=${generateToken(o.id)}`;
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.apiToken.deleteMany({ where: { userId } });
    const base = {
      depIata: "MUC",
      arrIata: "ICN",
      depLat: 48.354,
      depLon: 11.786,
      arrLat: 37.469,
      arrLon: 126.451,
      flightNumber: "LH718",
      departureTime: new Date(DEPARTURE),
      arrivalTime: new Date(DEPARTURE + 11 * 3_600_000),
      status: "flown",
    };
    flightId = (await prisma.flight.create({ data: { ...base, userId } })).id;
    otherFlightId = (await prisma.flight.create({ data: { ...base, userId: otherUserId } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("answers { track: null } before anything was recorded", async () => {
    const res = await request(app).get(`/api/v1/flights/${flightId}/track`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ track: null });
  });

  it("stores a recording in its own table and serves its line", async () => {
    const post = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId: "rec-1", points: points(60) });
    expect(post.status).toBe(201);
    expect(post.body.replayed).toBe(false);
    expect(post.body.track).toMatchObject({ flightId, uploadId: "rec-1", pointCount: 60 });
    expect(post.body.track.geometry).toBeUndefined();

    const get = await request(app).get(`/api/v1/flights/${flightId}/track`).set("Cookie", cookie);
    expect(get.status).toBe(200);
    expect(get.body.track.geometry[0]).toEqual([8, 50]);
    expect(get.body.track.segmentStarts).toEqual([0]);
    // Start on the departure airport's clock, end on the arrival's (ADR 0002 D3).
    expect(get.body.track.startedAt).toBeUndefined();
    expect(get.body.track.times.startedAt).toMatchObject({
      utc: "2026-10-03T08:00:00.000Z",
      zone: "Europe/Berlin",
      local: "2026-10-03T10:00:00",
    });
    expect(get.body.track.times.endedAt).toMatchObject({
      utc: "2026-10-03T08:59:00.000Z",
      zone: "Asia/Seoul",
    });
    expect(get.body.track.elevations).not.toBeNull();
    // 59 steps of 0.2° at 50°N, ~14.3 km each.
    expect(get.body.track.distanceKm).toBeGreaterThan(820);
    expect(get.body.track.distanceKm).toBeLessThan(870);

    // Never the provider column, which a lookup overwrites (D5).
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    expect(flight.actualRoute).toBeNull();
  });

  it("keeps a stretch without a fix as a hole, out of the distance", async () => {
    const res = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId: "rec-gap", points: points(40, { jumpAt: 20 }) });
    expect(res.status).toBe(201);
    const stored = await prisma.flightTrack.findUniqueOrThrow({ where: { flightId } });
    // Indices into the SIMPLIFIED line: each straight stretch keeps its two ends.
    expect(stored.segmentStarts).toEqual([0, 2]);
    // 38 recorded steps; the 430 km jump is not one of them.
    expect(stored.distanceKm).toBeLessThan(600);
  });

  it("answers an outbox retry with the stored row and writes nothing", async () => {
    const body = { uploadId: "rec-1", points: points(30) };
    const first = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send(body);
    const retry = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.track.id).toBe(first.body.track.id);
    expect(await prisma.flightTrack.count({ where: { flightId } })).toBe(1);
  });

  it("never lets a second recording displace the first unless asked to", async () => {
    await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId: "rec-full", points: points(60) });

    const refused = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId: "rec-partial", points: points(5) });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("TRACK_ALREADY_RECORDED");
    const kept = await prisma.flightTrack.findUniqueOrThrow({ where: { flightId } });
    expect(kept.uploadId).toBe("rec-full");
    expect(kept.pointCount).toBe(60);

    const replaced = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId: "rec-partial", replace: true, points: points(5) });
    expect(replaced.status).toBe(201);
    const now = await prisma.flightTrack.findUniqueOrThrow({ where: { flightId } });
    expect(now.uploadId).toBe("rec-partial");
    expect(now.pointCount).toBe(5);
  });

  it("refuses a recording a day away from the flight", async () => {
    const res = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId: "rec-x", points: points(10, { from: DEPARTURE + 36 * 3_600_000 }) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("TRACK_OUTSIDE_FLIGHT");
    expect(await prisma.flightTrack.count({ where: { flightId } })).toBe(0);
  });

  it.each([
    [
      "a latitude out of range",
      { uploadId: "a", points: [{ t: DEPARTURE, lat: 91, lon: 8 }, ...points(2)] },
    ],
    [
      "a time going backwards",
      { uploadId: "a", points: [...points(3), { t: DEPARTURE, lat: 50, lon: 9 }] },
    ],
    ["a single point", { uploadId: "a", points: points(1) }],
    ["no upload id", { points: points(3) }],
    [
      "an offset-less time string",
      { uploadId: "a", points: [{ t: "2026-10-03T08:00:00", lat: 50, lon: 8 }, ...points(2)] },
    ],
  ])("refuses %s with a stable code", async (_label, body) => {
    const res = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send(body);
    expect([400, 422]).toContain(res.status);
    expect(typeof res.body.code).toBe("string");
    expect(await prisma.flightTrack.count({ where: { flightId } })).toBe(0);
  });

  it("refuses more points than the limit", async () => {
    const res = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId: "big", points: points(FLIGHT_TRACK_MAX_POINTS + 1) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a body over the size limit before reading it", async () => {
    const res = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId: "pad", pad: "x".repeat(FLIGHT_TRACK_MAX_BODY_BYTES), points: points(3) });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("TRACK_BODY_TOO_LARGE");
  });

  it("answers another user's flight like a missing one, on every verb", async () => {
    const url = `/api/v1/flights/${otherFlightId}/track`;
    const post = await request(app)
      .post(url)
      .set("Cookie", cookie)
      .send({ uploadId: "steal", points: points(5) });
    expect(post.status).toBe(404);
    // forgejo#201: the code tells "flight gone" from "route missing on an old server".
    expect(post.body.code).toBe("FLIGHT_NOT_FOUND");
    expect((await request(app).get(url).set("Cookie", cookie)).status).toBe(404);
    expect((await request(app).delete(url).set("Cookie", cookie)).status).toBe(404);
    expect(await prisma.flightTrack.count({ where: { flightId: otherFlightId } })).toBe(0);

    // ...and the owner still reaches it.
    expect((await request(app).get(url).set("Cookie", otherCookie)).status).toBe(200);
  });

  it("takes the Companion's paired-device token and records the device", async () => {
    const token = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId,
        label: "Companion",
        lookupHash: token.lookupHash,
        hash: token.hash,
        scope: "write",
        deviceId: "device-abc",
        platform: "ios",
      },
    });
    const res = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Authorization", `Bearer ${token.plaintext}`)
      .send({ uploadId: "rec-phone", points: points(10) });
    expect(res.status).toBe(201);
    expect(res.body.track.deviceId).toBe("device-abc");
  });

  it("refuses a read-only token", async () => {
    const token = await generateApiToken();
    await prisma.apiToken.create({
      data: { userId, label: "ro", lookupHash: token.lookupHash, hash: token.hash, scope: "read" },
    });
    const res = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Authorization", `Bearer ${token.plaintext}`)
      .send({ uploadId: "rec-ro", points: points(10) });
    expect(res.status).toBe(403);
  });

  it("deletes the recording, and says 0 when there is none", async () => {
    await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId: "rec-1", points: points(10) });
    const first = await request(app)
      .delete(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie);
    expect(first.body).toEqual({ deleted: 1 });
    const second = await request(app)
      .delete(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie);
    expect(second.body).toEqual({ deleted: 0 });
  });

  it("goes with its flight", async () => {
    await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId: "rec-1", points: points(10) });
    await prisma.flight.delete({ where: { id: flightId } });
    expect(await prisma.flightTrack.count({ where: { flightId } })).toBe(0);
  });
});
