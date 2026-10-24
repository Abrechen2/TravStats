import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { setLocationProvider } from "../../services/locationProvider/provider";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeTrip, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * TravTrack's points API (TravTrack plan T3, ported from the archived
 * `/location/points` suite): only a paired phone sends, reads come in pages
 * with a cursor, a delete takes whole days on the profile clock, and the
 * provider never decides whether a queued point is taken (review focus 7).
 * With TravTrack off, an account that holds data keeps summary and delete
 * (review focus 14).
 */

const PREFIX = "travtrack-pts-";

describe("TravTrack — /travtrack/points", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherUserId: string;
  let cookie: string;
  let phone: string;
  let readOnly: string;

  async function token(uid: string, deviceId: string | null, scope: "write" | "read" = "write") {
    const t = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId: uid,
        label: "Companion",
        lookupHash: t.lookupHash,
        hash: t.hash,
        scope,
        deviceId,
        platform: deviceId ? "ios" : null,
      },
    });
    return `Bearer ${t.plaintext}`;
  }

  const post = (body: object, auth = phone) =>
    request(app).post("/api/v1/travtrack/points").set("Authorization", auth).send(body);
  const pt = (id: string, t: string, lat = 37.5665, lon = 126.978, extra: object = {}) => ({
    id,
    t,
    lat,
    lon,
    accuracy: 12,
    ...extra,
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    const u = await prisma.user.create({ data: { username: `${PREFIX}a`, passwordHash: "x" } });
    const o = await prisma.user.create({ data: { username: `${PREFIX}b`, passwordHash: "x" } });
    userId = u.id;
    otherUserId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId, otherUserId]);
    await prisma.apiToken.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    phone = await token(userId, "phone-1");
    readOnly = await token(userId, "phone-3", "read");
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("stores the points of a paired phone and answers a retry from the receipt", async () => {
    const body = { uploadId: "u1", points: [pt("a", "2026-10-12T01:00:00Z")] };
    const first = await post(body);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ stored: 1, replayed: false, linked: 0, unlinked: 0 });
    const again = await post(body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ stored: 1, replayed: true });
    const reused = await post({ uploadId: "u1", points: [pt("a", "2026-10-12T01:00:01Z")] });
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe("RECORDING_UPLOAD_ID_REUSED");
  });

  it("takes positions only from a paired device with write access", async () => {
    const browser = await request(app)
      .post("/api/v1/travtrack/points")
      .set("Cookie", cookie)
      .send({ uploadId: "w", points: [pt("a", "2026-10-12T01:00:00Z")] });
    expect(browser.status).toBe(403);
    expect(browser.body.code).toBe("TRAVTRACK_DEVICE_REQUIRED");
    const read = await post({ uploadId: "r", points: [pt("a", "2026-10-12T01:00:00Z")] }, readOnly);
    expect(read.status).toBe(403);
    const unpaired = await post(
      { uploadId: "x", points: [pt("a", "2026-10-12T01:00:00Z")] },
      await token(userId, null)
    );
    expect(unpaired.body.code).toBe("TRAVTRACK_DEVICE_REQUIRED");
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(0);
  });

  it("refuses an empty or oversized envelope", async () => {
    expect((await post({ uploadId: "e", points: [] })).status).toBe(400);
    expect((await post({ uploadId: "e2", points: [], gaps: [] })).status).toBe(400);
    const many = Array.from({ length: 5001 }, (_, i) => pt(`p${i}`, "2026-10-12T01:00:00Z"));
    expect((await post({ uploadId: "m", points: many })).status).toBeGreaterThanOrEqual(400);
    const bad = await post({
      uploadId: "g",
      points: [],
      gaps: [{ from: "2026-10-12T02:00:00Z", to: "2026-10-12T01:00:00Z", reason: "permission" }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
  });

  it("accepts a gap-only envelope", async () => {
    const res = await post({
      uploadId: "gap-only",
      points: [],
      gaps: [
        { from: "2026-10-12T01:00:00Z", to: "2026-10-12T02:00:00Z", reason: "recorderSilent" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ stored: 0, gapsStored: 1, outcomes: [] });
  });

  it("points queued before a switch to provider none are still accepted (201)", async () => {
    await setLocationProvider(userId, "travtrack");
    await setLocationProvider(userId, "none");
    const res = await post({ uploadId: "queued", points: [pt("a", "2026-10-12T01:00:00Z")] });
    expect(res.status).toBe(201);
    expect(res.body.stored).toBe(1);
  });

  it("403 TRAVTRACK_DISABLED once the admin switches TravTrack off — and nothing is stored", async () => {
    await switches.set({ beta: true, config: false });
    const res = await post({ uploadId: "off", points: [pt("a", "2026-10-12T01:00:00Z")] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(0);
  });

  it("with TravTrack off, an account holding data can still read its summary and delete a range", async () => {
    await post({ uploadId: "kept", points: [pt("a", "2026-10-12T01:00:00Z")] });
    await switches.set({ beta: true, config: false });

    const summary = await request(app).get("/api/v1/travtrack/summary").set("Cookie", cookie);
    expect(summary.status).toBe(200);
    expect(summary.body.pointCount).toBe(1);
    const page = await request(app)
      .get("/api/v1/travtrack/points")
      .query({ from: "2026-10-12T00:00:00Z", to: "2026-10-13T00:00:00Z" })
      .set("Cookie", cookie);
    expect(page.status).toBe(403);
    const del = await request(app)
      .delete("/api/v1/travtrack/points")
      .query({ from: "2026-10-12T00:00:00Z", to: "2026-10-13T00:00:00Z" })
      .set("Cookie", cookie);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ deleted: 1 });
  });

  it("deletes whole days on the profile's clock, both ends inclusive", async () => {
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Asia/Seoul" } } },
    });
    await post({
      uploadId: "days",
      points: [
        pt("before", "2026-10-11T14:59:00Z"), // 23:59 on 11 Oct in Seoul
        pt("first", "2026-10-11T15:00:00Z"), // 00:00 on 12 Oct in Seoul
        pt("last", "2026-10-13T14:59:00Z"), // 23:59 on 13 Oct in Seoul
        pt("after", "2026-10-13T15:00:00Z"),
      ],
    });
    const del = await request(app)
      .delete("/api/v1/travtrack/points")
      .query({ fromDay: "2026-10-12", toDay: "2026-10-13" })
      .set("Cookie", cookie);
    expect(del.body).toEqual({ deleted: 2 });
    const left = await prisma.travTrackPoint.findMany({ where: { userId }, orderBy: { t: "asc" } });
    expect(left.map((p) => p.originRef)).toEqual(["before", "after"]);

    const mixed = await request(app)
      .delete("/api/v1/travtrack/points")
      .query({ fromDay: "2026-10-12", to: "2026-10-13T00:00:00Z" })
      .set("Cookie", cookie);
    expect(mixed.status).toBe(400);
    const backwards = await request(app)
      .delete("/api/v1/travtrack/points")
      .query({ fromDay: "2026-10-13", toDay: "2026-10-12" })
      .set("Cookie", cookie);
    expect(backwards.status).toBe(400);
  });

  it("reads a span in pages that never end silently, and only the owner's", async () => {
    const points = Array.from({ length: 5 }, (_, i) =>
      pt(`p${i}`, `2026-10-12T01:0${i}:00Z`, 37.5 + i / 100)
    );
    await post({ uploadId: "u8", points });
    await prisma.travTrackPoint.create({
      data: {
        userId: otherUserId,
        t: new Date("2026-10-12T01:02:30Z"),
        tS: Date.parse("2026-10-12T01:02:30Z") / 1000,
        lat: 1,
        lon: 1,
        origin: "companion:x",
        originRef: "x",
      },
    });
    const range = { from: "2026-10-12T00:00:00Z", to: "2026-10-13T00:00:00Z" };
    const first = await request(app)
      .get("/api/v1/travtrack/points")
      .query({ ...range, limit: 2 })
      .set("Cookie", cookie);
    expect(first.status).toBe(200);
    expect(first.body.points.map((p: { lat: number }) => p.lat)).toEqual([37.5, 37.51]);
    const seen = [...first.body.points];
    let cursor = first.body.nextCursor;
    while (cursor) {
      const page = await request(app)
        .get("/api/v1/travtrack/points")
        .query({ ...range, limit: 2, cursor })
        .set("Cookie", cookie);
      seen.push(...page.body.points);
      cursor = page.body.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen.map((p: { id: string }) => p.id)).size).toBe(5);

    const summary = await request(app).get("/api/v1/travtrack/summary").set("Cookie", cookie);
    expect(summary.body).toMatchObject({
      pointCount: 5,
      firstAt: "2026-10-12T01:00:00.000Z",
      lastAt: "2026-10-12T01:04:00.000Z",
      devices: [{ deviceId: "phone-1", pointCount: 5 }],
      deletedRanges: 0,
      zones: 0,
    });
  });

  it("the page carries purpose and entries", async () => {
    const tripId = await makeTrip(userId);
    await post({
      uploadId: "linked",
      points: [
        pt("a", "2026-10-12T01:00:00Z", 1, 1, {
          purpose: "trip",
          entries: [{ kind: "trip", id: tripId }],
        }),
        pt("b", "2026-10-12T01:01:00Z", 1, 2),
      ],
    });
    const res = await request(app)
      .get("/api/v1/travtrack/points")
      .query({ from: "2026-10-12T00:00:00Z", to: "2026-10-13T00:00:00Z" })
      .set("Cookie", cookie);
    expect(
      res.body.points.map((p: { purpose: string; entries: unknown[] }) => [p.purpose, p.entries])
    ).toEqual([
      ["trip", [{ kind: "trip", id: tripId }]],
      ["everyday", []],
    ]);
  });

  it("the summary never names a privacy zone's points or a gap inside a zone", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", lat: 37.5665, lon: 126.978, radiusM: 250 },
    });
    const res = await post({
      uploadId: "zoned",
      points: [pt("home", "2026-10-12T01:00:00Z"), pt("far", "2026-10-12T01:05:00Z", 37.6, 127)],
      gaps: [{ from: "2026-10-12T02:00:00Z", to: "2026-10-12T03:00:00Z", reason: "permission" }],
    });
    expect(res.body.outcomes[0]).toMatchObject({ outcome: "dropped", reason: "privacy_zone" });
    const summary = await request(app).get("/api/v1/travtrack/summary").set("Cookie", cookie);
    expect(summary.body).toMatchObject({
      pointCount: 1,
      firstAt: "2026-10-12T01:05:00.000Z",
      lastAt: "2026-10-12T01:05:00.000Z",
      zones: 1,
    });
    expect(Object.keys(summary.body).sort()).toEqual(
      [
        "deletedRanges",
        "devices",
        "firstAt",
        "lastAt",
        "lastReceivedAt",
        "pointCount",
        "zones",
      ].sort()
    );
  });

  it("goes with the account", async () => {
    const gone = await prisma.user.create({
      data: { username: `${PREFIX}gone`, passwordHash: "x" },
    });
    const auth = await token(gone.id, "phone-g");
    await post({ uploadId: "g", points: [pt("a", "2026-10-12T01:00:00Z")] }, auth);
    expect(await prisma.travTrackPoint.count({ where: { userId: gone.id } })).toBe(1);
    await prisma.user.delete({ where: { id: gone.id } });
    expect(await prisma.travTrackPoint.count({ where: { userId: gone.id } })).toBe(0);
    expect(await prisma.travTrackUpload.count({ where: { userId: gone.id } })).toBe(0);
  });
});
