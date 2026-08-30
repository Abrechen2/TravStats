import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { FILE_LIMITS } from "../../config/constants";

/**
 * Task 4 (Phase 3b tour tracks): upload endpoint and track CRUD.
 *
 * `parseGpx` returning `null` ("could not be read as GPX") and `ingestTrack`
 * returning `null` ("no timestamps") are DIFFERENT user-facing failures —
 * see task-4-brief.md. The two 400 cases below assert the MESSAGES, not
 * just the shared status code, so the two can never silently collapse into
 * one.
 */

const VALID_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Fjord Loop</name>
    <trkseg>
      <trkpt lat="60.39" lon="5.32"><time>2026-06-01T08:00:00Z</time></trkpt>
      <trkpt lat="60.40" lon="5.33"><time>2026-06-01T08:05:00Z</time></trkpt>
      <trkpt lat="60.41" lon="5.34"><time>2026-06-01T08:10:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const NO_TIMESTAMP_GPX = `<gpx>
  <trk>
    <trkseg>
      <trkpt lat="60.39" lon="5.32"></trkpt>
      <trkpt lat="60.40" lon="5.33"></trkpt>
    </trkseg>
  </trk>
</gpx>`;

// Unclosed <trkpt> tag and no closing </gpx> — fast-xml-parser's own
// XMLValidator reliably rejects this, unlike parser.parse() alone.
const MALFORMED_GPX = `<gpx><trk><trkseg><trkpt lat="60.39" lon="5.32"</trkpt></trkseg></trk>`;

describe("Tour tracks — upload and CRUD", () => {
  let cookie: string;
  let otherCookie: string;
  let tripId: string;
  let routeId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tourtracks", "tourtracksother"] } } });

    const u = await prisma.user.create({
      data: { username: "tourtracks", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: "tourtracksother", passwordHash: await hashPassword("password123") },
    });
    otherCookie = `auth_token=${generateToken(other.id)}`;

    const trip = await prisma.trip.create({ data: { userId: u.id, name: "Norwegen 2024" } });
    tripId = trip.id;

    const route = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", cookie)
      .send({ name: "Fjordrunde", mode: "road" });
    routeId = route.body.route.id as string;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tourtracks", "tourtracksother"] } } });
    await prisma.$disconnect();
  });

  it("stores a valid GPX upload and returns its metadata", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/routes/${routeId}/tracks`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from(VALID_GPX), "loop.gpx");

    expect(res.status).toBe(201);
    expect(res.body.track).toMatchObject({
      routeId,
      source: "gpx",
      name: "Fjord Loop",
      pointCount: 3,
    });
    expect(res.body.track.startedAt).toBe("2026-06-01T08:00:00.000Z");
    expect(res.body.track.endedAt).toBe("2026-06-01T08:10:00.000Z");
    expect(res.body.track.distanceKm).toBeGreaterThan(0);
  });

  it("refuses a malformed GPX with 400 ('could not be read as GPX')", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/routes/${routeId}/tracks`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from(MALFORMED_GPX), "broken.gpx");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/could not be read as gpx/i);
  });

  it("refuses a GPX with no timestamps with 400 and a DIFFERENT message than a malformed file", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/routes/${routeId}/tracks`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from(NO_TIMESTAMP_GPX), "no-time.gpx");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no timestamps/i);
    expect(res.body.error.toLowerCase()).not.toContain("could not be read as gpx");
  });

  it("refuses a file above the size limit", async () => {
    const oversized = Buffer.alloc(FILE_LIMITS.GPX_TRACK_MAX_SIZE + 1, 0x20);
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/routes/${routeId}/tracks`)
      .set("Cookie", cookie)
      .attach("file", oversized, "huge.gpx");

    expect(res.status).toBe(400);
  }, 30000);

  it("404s another user's route rather than leaking its existence", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/routes/${routeId}/tracks`)
      .set("Cookie", otherCookie)
      .attach("file", Buffer.from(VALID_GPX), "loop.gpx");

    expect(res.status).toBe(404);
  });

  describe("list vs single-track geometry exposure", () => {
    let trackId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post(`/api/v1/trips/${tripId}/routes/${routeId}/tracks`)
        .set("Cookie", cookie)
        .attach("file", Buffer.from(VALID_GPX), "loop2.gpx");
      trackId = res.body.track.id as string;
    });

    it("the LIST response contains NO geometry key at all", async () => {
      const res = await request(app)
        .get(`/api/v1/trips/${tripId}/routes/${routeId}/tracks`)
        .set("Cookie", cookie);

      expect(res.status).toBe(200);
      expect(res.body.tracks.length).toBeGreaterThan(0);
      for (const track of res.body.tracks) {
        expect(track).not.toHaveProperty("geometry");
      }
    });

    it("the single-track GET DOES contain geometry", async () => {
      const res = await request(app)
        .get(`/api/v1/trips/${tripId}/routes/${routeId}/tracks/${trackId}`)
        .set("Cookie", cookie);

      expect(res.status).toBe(200);
      expect(res.body.track).toHaveProperty("geometry");
      expect(Array.isArray(res.body.track.geometry)).toBe(true);
      expect(res.body.track.geometry.length).toBeGreaterThan(0);
    });

    it("deletes the track; a second delete 404s", async () => {
      const first = await request(app)
        .delete(`/api/v1/trips/${tripId}/routes/${routeId}/tracks/${trackId}`)
        .set("Cookie", cookie);
      expect(first.status).toBe(204);

      const second = await request(app)
        .delete(`/api/v1/trips/${tripId}/routes/${routeId}/tracks/${trackId}`)
        .set("Cookie", cookie);
      expect(second.status).toBe(404);
    });
  });

  describe("auth middleware placement (regression)", () => {
    // Same regression this branch already hit once in phase 1 (see
    // tourRoutes.crud.test.ts): a router mounted at the wide `/api/v1` base
    // with a router-level `authenticate` swallows every LATER mount's
    // requests. This router must use per-route middleware only.
    it("does not intercept a public endpoint mounted after this router", async () => {
      const res = await request(app)
        .post("/api/v1/pairing/claim")
        .send({ code: "000000", deviceName: "test-device" });

      expect(res.status).not.toBe(401);
      expect(res.status).toBe(400);
    });

    it("still requires authentication on the tracks endpoints themselves", async () => {
      const res = await request(app).get(`/api/v1/trips/${tripId}/routes/${routeId}/tracks`);
      expect(res.status).toBe(401);
    });
  });
});
