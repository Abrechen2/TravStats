import request from "supertest";
import { jest } from "@jest/globals";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { encryptApiKey } from "../../utils/encryption";
import { setLocationProvider } from "../../services/locationProvider/provider";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  makeFlight,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../services/travtrack/__tests__/fixtures";

/**
 * A flight's track from the chosen source (TravTrack plan T5): the flight page
 * and the map's track lines. TravTrack lines join the map; Dawarich lines do
 * not (no remote fan-out on a map load) — those flights keep their great
 * circle and show the Dawarich track on their own page.
 */

const PREFIX = "travtrack-flight-provider-";
// The flight fixture departs 00:30Z on 12 Oct, lands 01:30Z; the recorder window is 00:00–02:00Z.
const DEP = Date.parse("2026-10-12T00:30:00Z");
const MIN = 60_000;

describe("flight tracks from the location provider", () => {
  const switches = travTrackSwitches();
  const realFetch = global.fetch;
  let userId: string;
  let cookie: string;
  let flightId: string;

  const flown = async () => {
    for (let i = 0; i < 6; i++) {
      await storePoint(userId, {
        t: DEP + i * 10 * MIN,
        lat: 37.4 - i * 0.6,
        lon: 126.45 + i * 0.01,
        links: i === 0 ? [{ kind: "flight", id: flightId }] : [],
      });
    }
  };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    flightId = await makeFlight(userId);
    global.fetch = jest.fn<typeof fetch>() as unknown as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("draws a TravTrack flight on its page from its points and says so", async () => {
    await setLocationProvider(userId, "travtrack");
    await flown();
    const res = await request(app).get(`/api/v1/flights/${flightId}/track`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      origin: "travtrack",
      coverage: "complete",
      alternatives: [],
      unchecked: [],
    });
    expect(res.body.track).toMatchObject({ flightId, source: "travtrack", pointCount: 6 });
    expect(res.body.track.geometry.length).toBeGreaterThanOrEqual(2);
  });

  it("a fix inside a zone is out of the flight's figures, though simplification would hide it", async () => {
    await setLocationProvider(userId, "travtrack");
    for (let i = 0; i < 10; i++) {
      await storePoint(userId, {
        t: DEP + i * MIN,
        lat: 37.4 - i * 0.06,
        // The sixth fix strays 4 m east — inside a 3 m zone around it.
        lon: i === 5 ? 126.45005 : 126.45,
      });
    }
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Klein", lat: 37.1, lon: 126.45005, radiusM: 3 },
    });
    const res = await request(app).get(`/api/v1/flights/${flightId}/track`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    // With a zone in force every figure describes the line as shown.
    expect(res.body.track.pointCount).toBe(res.body.track.geometry.length);
    expect(res.body.track.jitterDropped).toBeNull();
    // Nine steps of ~6.7 km would be ~60 km; the step over the zone is not counted.
    expect(res.body.track.distanceKm).toBeLessThan(50);
    expect(res.body.track.segmentStarts).toHaveLength(2);
  });

  it("track-lines draws a TravTrack flight from its points and marks origin", async () => {
    await setLocationProvider(userId, "travtrack");
    await flown();
    const res = await request(app).get("/api/v1/flights/track-lines").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.lines).toEqual([
      expect.objectContaining({ flightId, origin: "travtrack", segmentStarts: [0] }),
    ]);
  });

  it("track-lines draws a Dawarich user's flight as before (no line) and makes no Dawarich request", async () => {
    await prisma.userSettings.create({
      data: {
        userId,
        data: {},
        dawarichBaseUrl: "http://dawarich.local:3000",
        dawarichApiKey: encryptApiKey("own"),
      },
    });
    await setLocationProvider(userId, "dawarich");
    await flown(); // TravTrack points exist, but TravTrack is not the provider
    const res = await request(app).get("/api/v1/flights/track-lines").set("Cookie", cookie);
    expect(res.body.lines).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("an own recording keeps its line and is labelled travstats on the map", async () => {
    await prisma.flightTrack.create({
      data: {
        flightId,
        source: "companion",
        uploadId: "own",
        startedAt: new Date(DEP),
        endedAt: new Date(DEP + 3_600_000),
        geometry: [
          [126.45, 37.4],
          [126.5, 33.5],
        ],
        segmentStarts: [0],
        cumulativeKm: [0, 430],
        pointCount: 2,
        distanceKm: 430,
      },
    });
    await setLocationProvider(userId, "travtrack");
    await flown();
    const lines = await request(app).get("/api/v1/flights/track-lines").set("Cookie", cookie);
    expect(lines.body.lines).toEqual([expect.objectContaining({ flightId, origin: "travstats" })]);
    const page = await request(app).get(`/api/v1/flights/${flightId}/track`).set("Cookie", cookie);
    expect(page.body).toMatchObject({ origin: "travstats", alternatives: ["travtrack"] });
    expect(page.body.track.source).toBe("companion");
  });

  it("an own recording leaves the flight page and the map privacy-cut", async () => {
    await prisma.flightTrack.create({
      data: {
        flightId,
        source: "companion",
        uploadId: "own-zone",
        startedAt: new Date(DEP),
        endedAt: new Date(DEP + 3_600_000),
        geometry: [
          [126.45, 37.4],
          [126.47, 36.5],
          [126.5, 33.5],
        ],
        segmentStarts: [0],
        cumulativeKm: [0, 100, 430],
        elevations: [
          [0, 100],
          [50, 9000],
          [100, 11000],
          [300, 10000],
          [430, 50],
        ],
        pointCount: 3,
        distanceKm: 430,
      },
    });
    // A zone over the arrival end.
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Ziel", lat: 33.5, lon: 126.5, radiusM: 1000 },
    });
    const page = await request(app).get(`/api/v1/flights/${flightId}/track`).set("Cookie", cookie);
    expect(page.body.track.geometry).toEqual([
      [126.45, 37.4],
      [126.47, 36.5],
    ]);
    // Every figure describes what is left, and the hidden end has no time.
    // Measured on the shown chord (100.091 km), not on the stored 100.
    expect(page.body.track).toMatchObject({ distanceKm: 100.091, pointCount: 2 });
    // Only the samples at shown vertices; the one between them (50 km) may describe a hidden fix.
    expect(page.body.track.elevations).toEqual([
      [0, 100],
      [100.091, 11000],
    ]);
    expect(page.body.track.times.endedAt).toBeNull();
    expect(page.body.track.times.startedAt).not.toBeNull();
    expect(page.body.track).not.toHaveProperty("cumulativeKm");
    const lines = await request(app).get("/api/v1/flights/track-lines").set("Cookie", cookie);
    expect(JSON.stringify(lines.body)).not.toContain("33.5");
  });
});
