import request from "supertest";

import app from "../../index";
import { moving, standing } from "../../services/tracks/__tests__/jitterFixtures";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";

/**
 * The Companion's trip recording on the server (forgejo#316): received,
 * bounded by the trip's days and its flights, stored per upload, shown as a
 * line cut at every gap, exported as GPX and deleted on request.
 *
 * The trip is three days in Tokyo (+09:00): 1–3 May 2026 on Tokyo's clock,
 * i.e. 2026-04-30T15:00Z up to (not including) 2026-05-03T15:00Z. A day this
 * far from UTC is where a day filter read in UTC would put the first night's
 * points on the wrong day.
 */

const PREFIX = "triprec-test-";
const at = (iso: string) => ({ t: iso, lat: 35.68, lon: 139.76, accuracy: 25 });
const pt = (iso: string, lat: number, lon: number) => ({ t: iso, lat, lon });

describe("Trip recording — /trips/:id/recording", () => {
  let userId: string;
  let otherUserId: string;
  let cookie: string;
  let otherCookie: string;
  let tripId: string;
  let otherTripId: string;

  const post = (body: object, as = cookie, id = tripId) =>
    request(app).post(`/api/v1/trips/${id}/recording`).set("Cookie", as).send(body);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    const u = await prisma.user.create({ data: { username: `${PREFIX}a`, passwordHash: "x" } });
    const o = await prisma.user.create({ data: { username: `${PREFIX}b`, passwordHash: "x" } });
    userId = u.id;
    otherUserId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    otherCookie = `auth_token=${generateToken(o.id)}`;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.apiToken.deleteMany({ where: { userId } });
    const span = {
      name: "Tokio",
      startDate: new Date("2026-05-01T00:00:00Z"),
      endDate: new Date("2026-05-03T00:00:00Z"),
      startDay: new Date("2026-05-01T00:00:00Z"),
      endDay: new Date("2026-05-03T00:00:00Z"),
      startZone: "Asia/Tokyo",
      endZone: "Asia/Tokyo",
    };
    tripId = (await prisma.trip.create({ data: { ...span, userId } })).id;
    otherTripId = (await prisma.trip.create({ data: { ...span, userId: otherUserId } })).id;
    // A domestic hop on day 2: 03:00Z–05:00Z, so the recorder is armed 02:30Z–05:30Z.
    await prisma.flight.create({
      data: {
        userId,
        tripId,
        depIata: "HND",
        arrIata: "ITM",
        depLat: 35.55,
        depLon: 139.78,
        arrLat: 34.79,
        arrLon: 135.44,
        departureTime: new Date("2026-05-02T03:00:00Z"),
        arrivalTime: new Date("2026-05-02T05:00:00Z"),
        status: "flown",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("stores the points inside the trip, counts those outside it and in a flight's window", async () => {
    const res = await post({
      uploadId: "up-1",
      points: [
        at("2026-05-02T05:31:00Z"), // after the recorder window: kept
        at("2026-04-30T14:59:00Z"), // 23:59 on 30 April in Tokyo: before the trip
        at("2026-04-30T15:30:00Z"), // 00:30 on 1 May in Tokyo: kept
        at("2026-05-02T02:45:00Z"), // recorder armed: dropped
        at("2026-05-02T05:29:00Z"), // still armed: dropped
        at("2026-05-03T15:00:00Z"), // 00:00 on 4 May in Tokyo: after the trip
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      batchId: expect.any(String),
      accepted: 2,
      outsideTrip: 2,
      inFlight: 2,
      replayed: false,
    });
    const rows = await prisma.tripRecordingBatch.findMany({ where: { tripId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].points).toEqual([
      [Date.parse("2026-04-30T15:30:00Z"), 35.68, 139.76, 25],
      [Date.parse("2026-05-02T05:31:00Z"), 35.68, 139.76, 25],
    ]);
    expect(rows[0].pointCount).toBe(2);
    expect(rows[0].startedAt.toISOString()).toBe("2026-04-30T15:30:00.000Z");
  });

  it("answers a retried upload with what it stored, and writes nothing twice", async () => {
    const body = {
      uploadId: "up-retry",
      points: [at("2026-05-01T03:00:00Z"), at("2026-06-01T00:00:00Z")],
    };
    const first = await post(body);
    expect(first.status).toBe(201);
    const again = await post(body);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ...first.body, replayed: true });
    expect(await prisma.tripRecordingBatch.count({ where: { tripId } })).toBe(1);
  });

  it("refuses an uploadId already stored under another trip of the account", async () => {
    await post({ uploadId: "up-x", points: [at("2026-05-01T03:00:00Z")] }).expect(201);
    const second = await prisma.trip.create({
      data: {
        userId,
        name: "Zweite",
        startDay: new Date("2026-05-01T00:00:00Z"),
        endDay: new Date("2026-05-03T00:00:00Z"),
        startZone: "Asia/Tokyo",
        endZone: "Asia/Tokyo",
      },
    });
    const res = await post(
      { uploadId: "up-x", points: [at("2026-05-01T03:00:00Z")] },
      cookie,
      second.id
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RECORDING_UPLOAD_ID_REUSED");
  });

  it("stores nothing and answers batchId null when every point lies outside the trip", async () => {
    const res = await post({ uploadId: "up-out", points: [at("2026-07-01T00:00:00Z")] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      batchId: null,
      accepted: 0,
      outsideTrip: 1,
      inFlight: 0,
      replayed: false,
    });
    expect(await prisma.tripRecordingBatch.count({ where: { tripId } })).toBe(0);
  });

  it("refuses with TRIP_RECORDING_DISABLED and stores nothing while the account switch is off", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ tripRecording: { enabled: false } })
      .expect(200);
    const settings = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(settings.body.tripRecording).toEqual({ enabled: false });

    const res = await post({ uploadId: "up-off", points: [at("2026-05-01T03:00:00Z")] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TRIP_RECORDING_DISABLED");
    expect(await prisma.tripRecordingBatch.count({ where: { tripId } })).toBe(0);
  });

  it("answers the switch as on for an account that never set it", async () => {
    const settings = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(settings.body.tripRecording).toEqual({ enabled: true });
  });

  it("answers another user's trip like a missing one, and stores nothing", async () => {
    const res = await post(
      { uploadId: "up-foreign", points: [at("2026-05-01T03:00:00Z")] },
      cookie,
      otherTripId
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("TRIP_NOT_FOUND");
    await request(app)
      .get(`/api/v1/trips/${otherTripId}/recording`)
      .set("Cookie", cookie)
      .expect(404);
    await request(app)
      .delete(`/api/v1/trips/${otherTripId}/recording`)
      .set("Cookie", cookie)
      .expect(404);
    expect(await prisma.tripRecordingBatch.count({ where: { userId } })).toBe(0);
  });

  it("refuses a coordinate off the globe with its own code", async () => {
    const res = await post({
      uploadId: "up-bad",
      points: [{ t: "2026-05-01T03:00:00Z", lat: 91, lon: 10 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RECORDING_INVALID_POINT");
    expect(res.body.field).toBe("points.0.lat");
  });

  it("refuses a time without an offset instead of reading it on the server's clock", async () => {
    const res = await post({
      uploadId: "up-naive",
      points: [{ t: "2026-05-01T03:00:00", lat: 35, lon: 139 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("TIME_SHAPE_REQUIRED");
  });

  it("refuses a trip without a first or last day: no span, no guess", async () => {
    const open = await prisma.trip.create({ data: { userId, name: "Offen" } });
    const res = await post(
      { uploadId: "up-open", points: [at("2026-05-01T03:00:00Z")] },
      cookie,
      open.id
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("TRIP_RECORDING_NO_SPAN");
  });

  it("records the paired device and refuses a read-only token", async () => {
    const token = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId,
        label: "Companion",
        lookupHash: token.lookupHash,
        hash: token.hash,
        scope: "write",
        deviceId: "phone-1",
        platform: "ios",
      },
    });
    await request(app)
      .post(`/api/v1/trips/${tripId}/recording`)
      .set("Authorization", `Bearer ${token.plaintext}`)
      .send({ uploadId: "up-phone", points: [at("2026-05-01T03:00:00Z")] })
      .expect(201);
    const view = await request(app).get(`/api/v1/trips/${tripId}/recording`).set("Cookie", cookie);
    expect(view.body.summary.devices).toEqual(["phone-1"]);

    const read = await generateApiToken();
    await prisma.apiToken.create({
      data: { userId, label: "Lesen", lookupHash: read.lookupHash, hash: read.hash, scope: "read" },
    });
    await request(app)
      .post(`/api/v1/trips/${tripId}/recording`)
      .set("Authorization", `Bearer ${read.plaintext}`)
      .send({ uploadId: "up-read", points: [at("2026-05-01T03:00:00Z")] })
      .expect(403);
  });

  it("leaves a café's jitter off the map line, keeps every raw point stored and in the GPX (forgejo#319)", async () => {
    // An hour at a café table, a fix every five minutes scattering ±40 m at a
    // reported 35 m, then a twenty-minute walk.
    const cafe = standing(
      { lat: 35.68, lon: 139.76 },
      Date.parse("2026-05-03T00:00:00Z"),
      65,
      300,
      40,
      35
    );
    const walk = moving(
      { lat: 35.68, lon: 139.76 },
      cafe[cafe.length - 1].t,
      90,
      4.5,
      1200,
      300,
      10
    );
    const fixes = [...cafe, ...walk];
    await post({
      uploadId: "cafe",
      points: fixes.map((f) => ({
        t: new Date(f.t).toISOString(),
        lat: f.lat,
        lon: f.lon,
        accuracy: f.accuracy,
      })),
    }).expect(201);

    const res = await request(app).get(`/api/v1/trips/${tripId}/recording`).set("Cookie", cookie);
    expect(res.body.summary.pointCount).toBe(fixes.length);
    // The cloud collapses; a fix at its very edge may stand on its own.
    expect(res.body.summary.jitterDropped).toBeGreaterThanOrEqual(cafe.length - 2);
    expect(res.body.segments).toHaveLength(1);
    expect(res.body.segments[0].length).toBeLessThanOrEqual(2 + walk.length);

    const stored = await prisma.tripRecordingBatch.findFirstOrThrow({ where: { tripId } });
    expect(stored.pointCount).toBe(fixes.length);
    const gpx = await request(app)
      .get(`/api/v1/trips/${tripId}/recording/gpx`)
      .set("Cookie", cookie);
    expect(gpx.text.match(/<trkpt /g)).toHaveLength(fixes.length);
  });

  describe("reading it back", () => {
    beforeEach(async () => {
      await post({
        uploadId: "line",
        points: [
          // Day 1 in Tokyo (one of them still 30 April in UTC), a walk east.
          pt("2026-04-30T15:30:00Z", 35.68, 139.7),
          pt("2026-04-30T15:35:00Z", 35.68, 139.71),
          pt("2026-04-30T15:40:00Z", 35.68, 139.72),
          // Three hours later, a few hundred metres on: a gap in TIME.
          pt("2026-04-30T18:45:00Z", 35.68, 139.725),
          pt("2026-04-30T18:50:00Z", 35.68, 139.73),
          // Five minutes later but ~60 km away: a gap in DISTANCE.
          pt("2026-04-30T18:55:00Z", 35.68, 140.4),
          pt("2026-04-30T19:00:00Z", 35.68, 140.41),
          // Day 2 in Tokyo, after the flight's window.
          pt("2026-05-02T06:00:00Z", 34.7, 135.5),
          pt("2026-05-02T06:05:00Z", 34.7, 135.51),
        ],
      }).expect(201);
    });

    it("cuts the line at every gap and never joins across one", async () => {
      const res = await request(app).get(`/api/v1/trips/${tripId}/recording`).set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.summary.pointCount).toBe(9);
      const segments: Array<Array<[number, number]>> = res.body.segments;
      expect(segments).toHaveLength(4);
      expect(segments[0].at(-1)).toEqual([139.72, 35.68]);
      expect(segments[1][0]).toEqual([139.725, 35.68]);
      expect(segments[1].at(-1)).toEqual([139.73, 35.68]);
      expect(segments[2][0]).toEqual([140.4, 35.68]);
      expect(segments[3][0]).toEqual([135.5, 34.7]);
    });

    it("lists and filters days on the trip's clock, not UTC's", async () => {
      const all = await request(app).get(`/api/v1/trips/${tripId}/recording`).set("Cookie", cookie);
      expect(all.body.summary.days.map((d: { date: string }) => d.date)).toEqual([
        "2026-05-01",
        "2026-05-02",
      ]);
      expect(all.body.summary.firstAt).toMatchObject({
        utc: "2026-04-30T15:30:00.000Z",
        local: "2026-05-01T00:30:00",
        zone: "Asia/Tokyo",
        offset: "+09:00",
      });

      const day1 = await request(app)
        .get(`/api/v1/trips/${tripId}/recording?day=2026-05-01`)
        .set("Cookie", cookie);
      expect(day1.status).toBe(200);
      expect(day1.body.summary.pointCount).toBe(7);
      expect(day1.body.summary.lastAt.local).toBe("2026-05-01T04:00:00");
      expect(day1.body.summary.days).toHaveLength(2);
      expect(day1.body.segments).toHaveLength(3);

      const none = await request(app)
        .get(`/api/v1/trips/${tripId}/recording?day=2026-04-30`)
        .set("Cookie", cookie);
      expect(none.body.summary.pointCount).toBe(0);
      expect(none.body.segments).toEqual([]);
    });

    it("refuses a day that is not a calendar day", async () => {
      await request(app)
        .get(`/api/v1/trips/${tripId}/recording?day=2026-02-30`)
        .set("Cookie", cookie)
        .expect(400);
    });

    it("hands out every raw point as GPX, one trkseg per stretch", async () => {
      const res = await request(app)
        .get(`/api/v1/trips/${tripId}/recording/gpx`)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/gpx\+xml/);
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename=".*\.gpx"/);
      const xml = res.text;
      expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1"/);
      expect(xml.match(/<trkseg>/g)).toHaveLength(4);
      expect(xml.match(/<trkpt /g)).toHaveLength(9);
      expect(xml).toContain(
        '<trkpt lat="35.68" lon="139.7"><time>2026-04-30T15:30:00.000Z</time></trkpt>'
      );
    });

    it("deletes every batch of the trip, and then shows nothing", async () => {
      await request(app)
        .delete(`/api/v1/trips/${tripId}/recording`)
        .set("Cookie", cookie)
        .expect(204);
      expect(await prisma.tripRecordingBatch.count({ where: { tripId } })).toBe(0);
      const res = await request(app).get(`/api/v1/trips/${tripId}/recording`).set("Cookie", cookie);
      expect(res.body).toEqual({
        summary: {
          pointCount: 0,
          jitterDropped: 0,
          firstAt: null,
          lastAt: null,
          devices: [],
          days: [],
        },
        segments: [],
      });
    });

    it("goes with its trip when the trip is deleted", async () => {
      await prisma.trip.delete({ where: { id: tripId } });
      expect(await prisma.tripRecordingBatch.count({ where: { tripId } })).toBe(0);
    });
  });
});
