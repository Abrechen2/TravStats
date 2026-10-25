import { Prisma } from "../../prisma";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { reserveScan, scanStays } from "../../services/dawarich/stays/scan";
import type { DawarichClient, DawarichPoint } from "../../services/dawarich/dawarichClient";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));
// The pin's country comes from the same reverse geocoder the place form uses;
// faked so no test reaches Nominatim.
jest.mock("../../services/geo/nominatim", () => ({
  ...jest.requireActual("../../services/geo/nominatim"),
  completeAddressFromCoordinates: jest.fn(async () => ({
    city: "Seoul",
    country: "South Korea",
  })),
}));

/**
 * Review-side defects of the Dawarich stay findings (fix/ct142-places): what an
 * accepted stay writes, and what the review endpoints answer.
 */
const now = new Date("2026-10-11T06:00:00Z");
const points: DawarichPoint[] = [0, 10, 20, 30].map((m, i) => ({
  id: i + 1,
  latitude: 37.57,
  longitude: 126.97,
  timestampMs: Date.parse("2026-10-10T14:50:00Z") + m * 60_000,
  accuracy: 10,
  altitude: null,
  velocity: null,
  trackId: null,
}));
const client: DawarichClient = {
  checkHealth: async () => ({ reachable: true, version: null }),
  getPoints: async () => ({ points, truncated: false }),
};
const review = {
  name: "Seoul stop",
  placeId: null,
  tripId: null,
  lat: 37.57,
  lon: 126.97,
  startAt: { local: "2026-10-10T23:50" },
  endAt: { local: "2026-10-11T00:20" },
};
let userId: string, cookie: string;
const api = () => request(app);

async function scan() {
  await reserveScan(userId);
  await scanStays(userId, { now, client });
  return prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `stay-review-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  cookie = `auth_token=${generateToken(userId)}`;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, enabledDomains: ["poi"], data: {} },
    update: { enabledDomains: ["poi"], dawarichBaseUrl: null, dawarichApiKey: null },
  });
  await prisma.dawarichStay.deleteMany({ where: { userId } });
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.place.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
  await prisma.dawarichStayScan.upsert({
    where: { userId },
    create: { userId, enabled: true },
    update: {
      enabled: true,
      marketEnabled: false,
      venueEnabled: false,
      marketResult: Prisma.DbNull,
      leaseUntil: null,
      result: null,
    },
  });
});

describe("accepting a Dawarich stay", () => {
  it("gives the place it creates a country, so the stay counts in the passport", async () => {
    const row = await scan();
    const accepted = await api()
      .post(`/api/v1/dawarich-stays/${row.id}/accept`)
      .set("Cookie", cookie)
      .send(review);
    expect(accepted.status).toBe(200);
    const place = await prisma.place.findUniqueOrThrow({
      where: { id: accepted.body.data.placeId },
    });
    expect(place.country).toBe("South Korea");
    expect(place.isoCountryCode).toBe("KR");
    expect(place.city).toBe("Seoul");
  });
});

describe("accepting a finding that does not exist", () => {
  // Golden (owner decision 2026-10-25): SUGGESTION_NOT_FOUND is a TravTrack
  // row's answer. A missing row answers byte-for-byte what dev/travtrack did.
  it("answers the code-less 404 it always did", async () => {
    const res = await api()
      .post("/api/v1/dawarich-stays/00000000-0000-4000-8000-000000000000/accept")
      .set("Cookie", cookie)
      .send(review);
    expect(res.status).toBe(404);
    expect(res.text).toBe(JSON.stringify({ error: "Finding not found" }));
  });
});

describe("GET /dawarich-stays/settings", () => {
  it("answers connected:false only for a missing own connection", async () => {
    const r = await api().get("/api/v1/dawarich-stays/settings").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.data.connected).toBe(false);
    expect(r.body.data.pausedReason).toBe("connectionMissing");
  });
  it("lets a database failure surface instead of reporting a disconnected account", async () => {
    const spy = jest
      .spyOn(prisma.userSettings, "findUnique")
      .mockRejectedValueOnce(new Error("connection terminated"));
    try {
      const r = await api().get("/api/v1/dawarich-stays/settings").set("Cookie", cookie);
      expect(r.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("GET /dawarich-stays/choices", () => {
  it("is bounded, ordered totally, and says when it cut the list", async () => {
    await prisma.place.createMany({
      data: Array.from({ length: 2001 }, (_, i) => ({
        userId,
        name: i < 3 ? "Same name" : `Place ${String(i).padStart(4, "0")}`,
        lat: 1,
        lon: 1,
      })),
    });
    const r = await api().get("/api/v1/dawarich-stays/choices").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.data.places).toHaveLength(2000);
    expect(r.body.data.truncated).toEqual({ places: true, trips: false });
    const same = r.body.data.places
      .filter((p: { name: string }) => p.name === "Same name")
      .map((p: { id: string }) => p.id);
    expect(same).toEqual([...same].sort());
  });
  it("finds a place by name beyond the cap", async () => {
    await prisma.place.createMany({
      data: Array.from({ length: 2001 }, (_, i) => ({
        userId,
        name: `Place ${String(i).padStart(4, "0")}`,
        lat: 1,
        lon: 1,
      })),
    });
    const r = await api().get("/api/v1/dawarich-stays/choices?q=place 2000").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.data.places.map((p: { name: string }) => p.name)).toEqual(["Place 2000"]);
  });
});

describe("market coverage privacy", () => {
  // The OSM tile cache is instance-wide: a cache hit on a tile this account
  // never scanned says another account was there.
  it("does not publish how many tiles came from the shared cache", async () => {
    await prisma.dawarichStayScan.update({
      where: { userId },
      data: {
        marketResult: {
          scope: "markets",
          status: "partial",
          tiles: 3,
          totalTiles: 4,
          cachedTiles: 2,
          fetchedTiles: 1,
          staleTiles: 1,
          failedTiles: 1,
          missingAreaCount: 0,
          invalidAreaCount: 0,
          limited: false,
          alreadyRecordedCount: 0,
          createdCount: 1,
        },
      },
    });
    const r = await api().get("/api/v1/dawarich-stays/settings").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.data.marketResult).toEqual({
      scope: "markets",
      status: "partial",
      tiles: 3,
      totalTiles: 4,
      failedTiles: 1,
      missingAreaCount: 0,
      invalidAreaCount: 0,
      limited: false,
      alreadyRecordedCount: 0,
      createdCount: 1,
      staleMapData: true,
    });
    const patched = await api()
      .patch("/api/v1/dawarich-stays/settings")
      .set("Cookie", cookie)
      .send({ enabled: false });
    expect(patched.status).toBe(200);
    expect(patched.body.data.marketResult).not.toHaveProperty("cachedTiles");
    expect(JSON.stringify(patched.body)).not.toContain("fetchedTiles");
  });
});
