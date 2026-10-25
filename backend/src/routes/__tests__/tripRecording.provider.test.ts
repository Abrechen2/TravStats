import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { setLocationProvider } from "../../services/locationProvider/provider";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  makeTrip,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../services/travtrack/__tests__/fixtures";

/**
 * `GET /trips/:id/recording` and its GPX from the chosen source (TravTrack
 * plan T5): a trip without an own recording is drawn from TravTrack, per
 * device, privacy-cut on its final geometry, and the summary says where the
 * line came from.
 */

const PREFIX = "travtrack-trip-provider-";
const DAY = Date.parse("2026-10-12T00:00:00Z");
const MIN = 60_000;

describe("trip recording from the location provider", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;
  let tripId: string;

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    tripId = await makeTrip(userId);
    await setLocationProvider(userId, "travtrack");
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("two phones on one trip stay two devices in the map answer and in the GPX", async () => {
    for (let i = 0; i < 4; i++) {
      await storePoint(userId, {
        t: DAY + i * MIN,
        lat: 37.5 + i * 0.001,
        lon: 127,
        device: "phone-a",
      });
      await storePoint(userId, {
        t: DAY + i * MIN + 1000,
        lat: 35.1 + i * 0.001,
        lon: 129,
        device: "phone-b",
      });
    }
    const res = await request(app).get(`/api/v1/trips/${tripId}/recording`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      origin: "travtrack",
      coverage: "complete",
      alternatives: [],
      pointCount: 8,
      devices: ["phone-a", "phone-b"],
      uploadedWithoutDevice: false,
    });
    expect(res.body.segments).toHaveLength(2);

    const gpx = await request(app)
      .get(`/api/v1/trips/${tripId}/recording/gpx`)
      .set("Cookie", cookie);
    expect(gpx.status).toBe(200);
    expect(gpx.text.match(/<trkseg>/g)).toHaveLength(2);
  });

  it("two fixes on either side of a privacy zone, two minutes apart, are two segments", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", lat: 37.5665, lon: 126.978, radiusM: 250 },
    });
    // West of the zone, then east of it: the straight line between them crosses it.
    await storePoint(userId, { t: DAY, lat: 37.5665, lon: 126.95 });
    await storePoint(userId, { t: DAY + MIN, lat: 37.5665, lon: 126.96 });
    await storePoint(userId, { t: DAY + 3 * MIN, lat: 37.5665, lon: 126.996 });
    await storePoint(userId, { t: DAY + 4 * MIN, lat: 37.5665, lon: 127.006 });

    const res = await request(app).get(`/api/v1/trips/${tripId}/recording`).set("Cookie", cookie);
    expect(res.body.segments).toHaveLength(2);
    const gpx = await request(app)
      .get(`/api/v1/trips/${tripId}/recording/gpx`)
      .set("Cookie", cookie);
    expect(gpx.text.match(/<trkseg>/g)).toHaveLength(2);
  });

  it("a recording wholly inside a privacy zone gives away nothing, not even its summary", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", lat: 37.5665, lon: 126.978, radiusM: 500 },
    });
    for (let i = 0; i < 4; i++) {
      await storePoint(userId, {
        t: DAY + i * MIN,
        lat: 37.5665 + i * 0.0002,
        lon: 126.978,
        device: "phone-a",
      });
    }
    const res = await request(app).get(`/api/v1/trips/${tripId}/recording`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      pointCount: 0,
      jitterDropped: 0,
      firstAt: null,
      lastAt: null,
      devices: [],
      days: [],
    });
    expect(res.body.segments).toEqual([]);
  });

  it("the summary counts only what the privacy cut lets through", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", lat: 37.5665, lon: 126.978, radiusM: 500 },
    });
    // Two fixes at home on the evening before, then a walk far from it.
    await storePoint(userId, { t: DAY + 60 * MIN, lat: 37.5665, lon: 126.978, device: "home" });
    await storePoint(userId, { t: DAY + 61 * MIN, lat: 37.5666, lon: 126.978, device: "home" });
    for (let i = 0; i < 3; i++) {
      await storePoint(userId, {
        t: DAY + (600 + i) * MIN,
        lat: 37.6 + i * 0.001,
        lon: 127.05,
        device: "phone-a",
      });
    }
    const res = await request(app).get(`/api/v1/trips/${tripId}/recording`).set("Cookie", cookie);
    expect(res.body.summary).toMatchObject({ pointCount: 3, devices: ["phone-a"] });
    expect(res.body.summary.firstAt.utc).toBe(new Date(DAY + 600 * MIN).toISOString());
  });

  it("an own recording inside a zone is summarised from the cut too", async () => {
    await setLocationProvider(userId, "none");
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", lat: 37.5665, lon: 126.978, radiusM: 500 },
    });
    await prisma.tripRecordingBatch.create({
      data: {
        userId,
        tripId,
        deviceId: "phone-own",
        uploadId: `${PREFIX}own-inside`,
        startedAt: new Date(DAY),
        endedAt: new Date(DAY + 2 * MIN),
        points: [
          [DAY, 37.5665, 126.978, 5],
          [DAY + MIN, 37.5666, 126.978, 5],
          [DAY + 2 * MIN, 37.5667, 126.978, 5],
        ],
        pointCount: 3,
        skippedOutsideTrip: 0,
        skippedInFlight: 0,
      },
    });
    const res = await request(app).get(`/api/v1/trips/${tripId}/recording`).set("Cookie", cookie);
    expect(res.body.summary).toMatchObject({
      origin: "travstats",
      pointCount: 0,
      firstAt: null,
      lastAt: null,
      devices: [],
      uploadedWithoutDevice: false,
      days: [],
    });
  });

  it("?source= that holds nothing is 404 TRACK_SOURCE_NOT_AVAILABLE; an unknown one is 400", async () => {
    const none = await request(app)
      .get(`/api/v1/trips/${tripId}/recording`)
      .query({ source: "travstats" })
      .set("Cookie", cookie);
    expect(none.status).toBe(404);
    expect(none.body.code).toBe("TRACK_SOURCE_NOT_AVAILABLE");
    const odd = await request(app)
      .get(`/api/v1/trips/${tripId}/recording`)
      .query({ source: "owntracks" })
      .set("Cookie", cookie);
    expect(odd.status).toBe(400);
  });

  it("no own recording and no working provider is an empty answer with no origin", async () => {
    await setLocationProvider(userId, "none");
    const res = await request(app).get(`/api/v1/trips/${tripId}/recording`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ pointCount: 0, origin: null, coverage: null });
    expect(res.body.segments).toEqual([]);
  });
});
