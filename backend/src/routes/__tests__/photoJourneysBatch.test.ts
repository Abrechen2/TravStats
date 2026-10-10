import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

const searchAssetsByDate = jest.fn<(range: unknown) => Promise<unknown>>();
jest.mock("../../services/immich/immichClient", () => ({
  createImmichClient: () => ({ searchAssetsByDate }),
}));
const getImmichConnection = jest.fn<(userId: string) => Promise<unknown>>();
jest.mock("../../services/immich/immichResolver", () => ({
  getImmichConnection: (userId: string) => getImmichConnection(userId),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import type { PlaceResult } from "../../services/geo/photon";
import { scanPhotoJourneys } from "../../services/photoJourneys/scan";
import type { PlaceNameGeocoder } from "../../services/places/placeNameBackfill";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * forgejo#211, O5: the visit suggestions are reviewed TOGETHER — several
 * accepted, corrected or rejected in one request, each with its own outcome.
 * What is pinned: one failing item neither undoes nor hides the others and
 * says why with a stable code; corrections (name, own place, time) reach the
 * visit; a place already visited that day gets no second visit; a rejected
 * suggestion is not asked again; the list carries the nearest logged visit.
 *
 * Immich and Photon are fakes; no test reaches the network.
 */
const PALACE = { lat: 37.5796, lon: 126.977 };
const MEMORIAL = { lat: 37.5365, lon: 126.9772 };
const CONNECTION = { baseUrl: "http://immich.test", apiKey: "k", source: "user" };

const asset = (id: string, takenAt: string, at: { lat: number; lon: number }) => ({
  id,
  type: "IMAGE",
  fileCreatedAt: takenAt,
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1234,
  lat: at.lat,
  lon: at.lon,
});

/** Five photos over twenty minutes from `hourUtc`:10 on 1 May 2026. */
const stop = (prefix: string, hourUtc: string, at: { lat: number; lon: number }) =>
  [0, 4, 9, 14, 20].map((minute, i) =>
    asset(
      `${prefix}-${i}`,
      `2026-05-01T${hourUtc}:${String(10 + minute).padStart(2, "0")}:00.000Z`,
      {
        lat: at.lat + i * 0.0002,
        lon: at.lon,
      }
    )
  );
const ASSETS = [...stop("palace", "02", PALACE), ...stop("memorial", "07", MEMORIAL)];

const named = (name: string, ref: string, at: { lat: number; lon: number }): PlaceResult => ({
  ...at,
  name,
  type: "museum",
  externalRef: ref,
  city: "Seoul",
  country: "South Korea",
  countryCode: "kr",
});
const near = (at: { lat: number }, target: { lat: number }) => Math.abs(at.lat - target.lat) < 0.01;
const photon: PlaceNameGeocoder = {
  searchEnglish: async () => null,
  reverseEnglish: async (lat: number) =>
    near({ lat }, PALACE)
      ? [named("Gyeongbokgung", "osm:way/2", PALACE)]
      : [named("War Memorial of Korea", "osm:way/9", MEMORIAL)],
  reverseDefault: async () => null,
};

const WINDOW = { since: new Date("2026-04-01T00:00:00Z"), until: new Date("2026-06-01T00:00:00Z") };

describe("POST /photo-journeys/batch (forgejo#211, O5)", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `pj-batch-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    tripId = (
      await prisma.trip.create({
        data: {
          userId,
          name: "Korea",
          startDate: new Date("2026-04-28T00:00:00Z"),
          endDate: new Date("2026-05-06T00:00:00Z"),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  beforeEach(async () => {
    await prisma.photoJourney.deleteMany({ where: { userId } });
    await prisma.placeVisit.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    getImmichConnection.mockReset();
    getImmichConnection.mockResolvedValue(CONNECTION);
    searchAssetsByDate.mockReset();
    searchAssetsByDate.mockResolvedValue({ assets: ASSETS, truncated: false });
  });

  const scan = () => scanPhotoJourneys(userId, { ...WINDOW, geocoder: photon });
  const findings = async () => {
    await scan();
    const rows = await prisma.photoJourney.findMany({ where: { userId, status: "pending" } });
    const palace = rows.find((row) => row.suggestedName === "Gyeongbokgung")!;
    const memorial = rows.find((row) => row.suggestedName === "War Memorial of Korea")!;
    expect(palace).toBeDefined();
    expect(memorial).toBeDefined();
    // The photo search for linking is answered "no library" from here on.
    getImmichConnection.mockResolvedValue(null);
    return { palace, memorial };
  };
  const batch = (items: unknown[]) =>
    request(app).post("/api/v1/photo-journeys/batch").set("Cookie", cookie).send({ items });

  it("accepts several at once, each its own visit in the trip", async () => {
    const { palace, memorial } = await findings();
    const res = await batch([
      { id: palace.id, action: "accept" },
      { id: memorial.id, action: "accept" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({ accepted: 2, dismissed: 0, failed: 0 });
    expect(res.body.data.results.map((r: { outcome: string }) => r.outcome)).toEqual([
      "accepted",
      "accepted",
    ]);
    expect(await prisma.placeVisit.count({ where: { userId, tripId } })).toBe(2);
    expect(await prisma.photoJourney.count({ where: { userId, status: "accepted" } })).toBe(2);
  });

  it("answers each item on its own: one failure neither undoes nor hides the others", async () => {
    const { palace, memorial } = await findings();
    const otherKind = await prisma.photoJourney.create({
      data: {
        userId,
        fingerprint: `trip-${stamp}`,
        kind: "trip",
        startDate: new Date("2025-01-01T00:00:00Z"),
        endDate: new Date("2025-01-03T00:00:00Z"),
        photoCount: 10,
        locatedCount: 10,
        lat: 48.1,
        lon: 11.5,
        previewAssetIds: [],
      },
    });
    const res = await batch([
      { id: palace.id, action: "accept" },
      { id: otherKind.id, action: "accept" },
      { id: memorial.id, action: "accept", placeId: "00000000-0000-4000-8000-000000000000" },
      { id: "11111111-1111-4111-8111-111111111111", action: "dismiss" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.data.results).toEqual([
      expect.objectContaining({ id: palace.id, outcome: "accepted" }),
      { id: otherKind.id, action: "accept", outcome: "failed", code: "NOT_A_VISIT" },
      { id: memorial.id, action: "accept", outcome: "failed", code: "VISIT_PLACE_NOT_FOUND" },
      {
        id: "11111111-1111-4111-8111-111111111111",
        action: "dismiss",
        outcome: "failed",
        code: "NOT_FOUND",
      },
    ]);
    expect(res.body.data.summary).toEqual({ accepted: 1, dismissed: 0, failed: 3 });
    // The failed ones are still questions; nothing was made for them.
    expect(
      (await prisma.photoJourney.findUniqueOrThrow({ where: { id: memorial.id } })).status
    ).toBe("pending");
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
  });

  it("takes the reader's corrections: name, an own place, the time", async () => {
    const { palace, memorial } = await findings();
    const own = await prisma.place.create({
      data: { userId, name: "Yongsan museum quarter", lat: 37.53, lon: 126.98 },
    });
    const res = await batch([
      {
        id: palace.id,
        action: "accept",
        name: "Gyeongbok Palace",
        visitedAt: { local: "2026-05-01T10:30" },
      },
      { id: memorial.id, action: "accept", placeId: own.id },
    ]);
    expect(res.body.data.summary.accepted).toBe(2);
    const [first, second] = res.body.data.results;

    const palacePlace = await prisma.place.findUniqueOrThrow({
      where: { id: first.created.placeId },
    });
    expect(palacePlace.name).toBe("Gyeongbok Palace");
    const palaceVisit = await prisma.placeVisit.findUniqueOrThrow({
      where: { id: first.created.placeVisitId },
    });
    // 10:30 on the place's clock (Seoul, UTC+9).
    expect(palaceVisit.visitedAtUtc).toEqual(new Date("2026-05-01T01:30:00.000Z"));

    expect(second.created).toMatchObject({
      placeId: own.id,
      placeCreated: false,
      visitCreated: true,
    });
    expect(await prisma.place.count({ where: { userId } })).toBe(2);
  });

  it("says which item's time could not be read, and keeps the rest", async () => {
    const { palace, memorial } = await findings();
    const res = await batch([
      { id: palace.id, action: "accept", visitedAt: "2026-05-01T10:30:00Z" },
      { id: memorial.id, action: "dismiss" },
    ]);
    expect(res.body.data.results[0]).toMatchObject({ outcome: "failed", code: "TIME_INVALID" });
    expect(res.body.data.results[1]).toMatchObject({ outcome: "dismissed" });
  });

  it("links a place already visited that day instead of recording the stop twice", async () => {
    const { palace } = await findings();
    const own = await prisma.place.create({
      data: { userId, name: "Gyeongbokgung", lat: 37.6, lon: 126.98 },
    });
    const logged = await prisma.placeVisit.create({
      data: { userId, placeId: own.id, visitedAt: new Date("2026-05-01T09:00:00Z") },
    });
    const res = await batch([{ id: palace.id, action: "accept", placeId: own.id }]);
    expect(res.body.data.results[0].created).toEqual({
      placeId: own.id,
      placeVisitId: logged.id,
      placeCreated: false,
      visitCreated: false,
    });
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
    expect(await prisma.photoJourney.findUniqueOrThrow({ where: { id: palace.id } })).toMatchObject(
      { status: "accepted", createdPlaceVisitId: logged.id }
    );
  });

  it("rejects several at once, and a rejected suggestion does not come back", async () => {
    const { palace, memorial } = await findings();
    const res = await batch([
      { id: palace.id, action: "dismiss" },
      { id: memorial.id, action: "dismiss" },
    ]);
    expect(res.body.data.summary).toEqual({ accepted: 0, dismissed: 2, failed: 0 });

    getImmichConnection.mockResolvedValue(CONNECTION);
    await scan();
    expect(await prisma.photoJourney.count({ where: { userId, status: "pending" } })).toBe(0);
    expect(await prisma.photoJourney.count({ where: { userId, status: "dismissed" } })).toBe(2);

    // An answered question cannot be accepted after all, nor an accepted one rejected.
    const late = await batch([{ id: palace.id, action: "accept" }]);
    expect(late.body.data.results[0]).toMatchObject({
      outcome: "failed",
      code: "ALREADY_ANSWERED",
    });
  });

  it("refuses to reject an accepted suggestion, which already made a visit", async () => {
    const { palace } = await findings();
    await batch([{ id: palace.id, action: "accept" }]);
    const res = await batch([{ id: palace.id, action: "dismiss" }]);
    expect(res.body.data.results[0]).toMatchObject({ outcome: "failed", code: "ALREADY_ANSWERED" });
    expect((await prisma.photoJourney.findUniqueOrThrow({ where: { id: palace.id } })).status).toBe(
      "accepted"
    );
  });

  it("is per caller: another user's finding is NOT_FOUND and untouched", async () => {
    const { palace } = await findings();
    const stranger = await prisma.user.create({
      data: { username: `pj-batch-other-${stamp}`, passwordHash: "x" },
    });
    try {
      const res = await request(app)
        .post("/api/v1/photo-journeys/batch")
        .set("Cookie", `auth_token=${generateToken(stranger.id)}`)
        .send({ items: [{ id: palace.id, action: "dismiss" }] });
      expect(res.body.data.results[0]).toMatchObject({ outcome: "failed", code: "NOT_FOUND" });
      expect(
        (await prisma.photoJourney.findUniqueOrThrow({ where: { id: palace.id } })).status
      ).toBe("pending");
    } finally {
      await prisma.user.delete({ where: { id: stranger.id } });
    }
  });

  it("refuses an empty batch, a duplicate id and an oversized one as a whole", async () => {
    const { palace } = await findings();
    expect((await batch([])).status).toBe(400);
    expect(
      (
        await batch([
          { id: palace.id, action: "dismiss" },
          { id: palace.id, action: "accept" },
        ])
      ).status
    ).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      action: "dismiss",
    }));
    expect((await batch(many)).status).toBe(400);
  });

  it("lists each suggestion with the nearest logged visit, and flags one logged since the scan", async () => {
    await findings();
    const station = await prisma.place.create({
      data: { userId, name: "Yongsan Station", lat: 37.5298, lon: 126.9648 },
    });
    await prisma.placeVisit.create({
      data: { userId, placeId: station.id, tripId, visitedAt: new Date("2026-05-02T09:00:00Z") },
    });
    const gate = await prisma.place.create({
      data: { userId, name: "Gwanghwamun", lat: PALACE.lat + 0.0005, lon: PALACE.lon },
    });
    await prisma.placeVisit.create({
      data: { userId, placeId: gate.id, visitedAt: new Date("2026-05-01T12:00:00Z") },
    });

    const res = await request(app).get("/api/v1/photo-journeys").set("Cookie", cookie);
    const byName = (name: string) =>
      res.body.data.find((row: { suggestedName: string }) => row.suggestedName === name);
    expect(byName("War Memorial of Korea").nearestVisit).toMatchObject({
      placeName: "Yongsan Station",
      sameDay: false,
      withinReach: false,
      distanceKm: expect.closeTo(1.3, 0),
    });
    expect(byName("Gyeongbokgung").nearestVisit).toMatchObject({
      placeId: gate.id,
      sameDay: true,
      withinReach: true,
    });
  });
});
