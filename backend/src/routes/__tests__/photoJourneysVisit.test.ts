import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";
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
 * forgejo#211: photos taken during a recorded trip at a spot with no visit
 * become `visit` findings, and accepting one creates the place and the visit
 * on the server. Measured on prod (Korea, 2026-10-07): 82 located photos at
 * Gyeongbokgung, a recorded trip, no visit — and nothing could say so,
 * because the journey scan reads only the days no travel explains.
 *
 * Immich and Photon are fakes; no test reaches the network.
 */
const PALACE = { lat: 37.5796, lon: 126.977 };
const CONNECTION = { baseUrl: "http://immich.test", apiKey: "k", source: "user" };

const asset = (id: string, takenAt: string, at: { lat: number; lon: number } | null) => ({
  id,
  type: "IMAGE",
  fileCreatedAt: takenAt,
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1234,
  lat: at?.lat ?? null,
  lon: at?.lon ?? null,
});

/** Five photos over twenty minutes at the palace on 1 May 2026, 14:10 Seoul time. */
const PALACE_STOP = [0, 4, 9, 14, 20].map((minute, i) =>
  asset(`palace-${i}`, `2026-05-01T05:${String(10 + minute).padStart(2, "0")}:00.000Z`, {
    lat: PALACE.lat + i * 0.0002,
    lon: PALACE.lon,
  })
);

const hit = (over: Partial<PlaceResult> & { name: string }): PlaceResult => ({
  ...PALACE,
  ...over,
});
const photon: PlaceNameGeocoder = {
  searchEnglish: async () => null,
  reverseEnglish: async () => [
    hit({ name: "Sajik-ro", type: "primary", externalRef: "osm:way/1" }),
    hit({
      name: "Gyeongbokgung",
      type: "castle",
      externalRef: "osm:way/2",
      city: "Seoul",
      country: "South Korea",
      countryCode: "kr",
    }),
  ],
  reverseDefault: async () => [hit({ name: "경복궁", externalRef: "osm:way/2" })],
};

const WINDOW = { since: new Date("2026-04-01T00:00:00Z"), until: new Date("2026-06-01T00:00:00Z") };

describe("visit findings (forgejo#211)", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;

  // The kind lives behind the beta switch; the suite turns it on and puts it
  // back, so a test database that boots with the default (off) still sees it.
  let betaBefore: boolean;

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `pj-visit-${stamp}`, passwordHash } }))
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
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  beforeEach(async () => {
    await prisma.photoJourney.deleteMany({ where: { userId } });
    await prisma.placeVisit.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    searchAssetsByDate.mockReset();
    getImmichConnection.mockReset();
    getImmichConnection.mockResolvedValue(CONNECTION);
    searchAssetsByDate.mockResolvedValue({ assets: PALACE_STOP, truncated: false });
  });

  const scan = () => scanPhotoJourneys(userId, { ...WINDOW, geocoder: photon });
  const pending = () => prisma.photoJourney.findMany({ where: { userId, status: "pending" } });

  describe("the scan", () => {
    it("writes no visit finding while the beta switch is off", async () => {
      await updateInstanceSettings({ betaFeaturesEnabled: false });
      try {
        const outcome = await scan();
        expect(outcome).toMatchObject({ kind: "scanned", created: 0 });
        expect(await pending()).toHaveLength(0);
      } finally {
        await updateInstanceSettings({ betaFeaturesEnabled: true });
      }
    });

    it("writes a stop inside the trip as a visit finding, named by the lookup", async () => {
      const outcome = await scan();
      expect(outcome).toMatchObject({ kind: "scanned", created: 1, updated: 0 });

      const rows = await pending();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "visit",
        tripId,
        placeId: null,
        suggestedName: "Gyeongbokgung",
        suggestedLocalName: "경복궁",
        suggestedRef: "osm:way/2",
        suggestedCategory: "landmark",
        city: "Seoul",
        countryCode: "KR",
        photoCount: 5,
        locatedCount: 5,
        startDate: new Date("2026-05-01T05:10:00.000Z"),
        endDate: new Date("2026-05-01T05:30:00.000Z"),
      });
      expect(rows[0].previewAssetIds).toEqual(["palace-0", "palace-1", "palace-2"]);
    });

    it("updates the row on a re-scan rather than writing a second one", async () => {
      await scan();
      const again = await scan();
      expect(again).toMatchObject({ created: 0, updated: 1 });
      expect(await prisma.photoJourney.count({ where: { userId } })).toBe(1);
    });

    it("never re-asks a dismissed question", async () => {
      await scan();
      const [row] = await pending();
      await request(app)
        .patch(`/api/v1/photo-journeys/${row.id}`)
        .set("Cookie", cookie)
        .send({ status: "dismissed" });

      await scan();
      expect(await pending()).toHaveLength(0);
      expect(await prisma.place.count({ where: { userId } })).toBe(0);
    });

    it("writes nothing for a stop at an own place already visited that day", async () => {
      const place = await prisma.place.create({
        data: { userId, name: "Gyeongbokgung", ...PALACE },
      });
      await prisma.placeVisit.create({
        data: { userId, placeId: place.id, visitedAt: new Date("2026-05-01T14:10:00Z") },
      });
      await scan();
      expect(await pending()).toHaveLength(0);
    });

    it("points at an own place within reach that has no visit that day", async () => {
      const place = await prisma.place.create({
        data: { userId, name: "Gyeongbokgung", localName: "경복궁", ...PALACE },
      });
      await scan();
      const [row] = await pending();
      expect(row).toMatchObject({ placeId: place.id, suggestedName: "Gyeongbokgung" });
    });

    it("stands on its dates when nothing within reach has a name", async () => {
      const nothing: PlaceNameGeocoder = {
        searchEnglish: async () => null,
        reverseEnglish: async () => [],
        reverseDefault: async () => null,
      };
      await scanPhotoJourneys(userId, { ...WINDOW, geocoder: nothing });
      const [row] = await pending();
      expect(row).toMatchObject({ kind: "visit", suggestedName: null, suggestedRef: null });
    });
  });

  describe("GET /photo-journeys", () => {
    it("carries the trip's name, the suggested names and the stop's local clock", async () => {
      await scan();
      const res = await request(app).get("/api/v1/photo-journeys").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data[0]).toMatchObject({
        kind: "visit",
        tripId,
        tripName: "Korea",
        suggestedName: "Gyeongbokgung",
        suggestedLocalName: "경복궁",
        suggestedRef: "osm:way/2",
        label: "Gyeongbokgung",
        startDay: "2026-05-01",
        startLocal: "2026-05-01T14:10:00",
        endLocal: "2026-05-01T14:30:00",
      });
    });
  });

  describe("PATCH /photo-journeys/:id accepted", () => {
    const accept = (id: string, body: Record<string, unknown> = {}) =>
      request(app)
        .patch(`/api/v1/photo-journeys/${id}`)
        .set("Cookie", cookie)
        .send({ status: "accepted", ...body });

    it("creates the place and the visit in the trip, and links them to the row", async () => {
      await scan();
      const [row] = await pending();
      getImmichConnection.mockResolvedValue(null);

      const res = await accept(row.id);
      expect(res.status).toBe(200);
      expect(res.body.data.created).toMatchObject({ placeCreated: true });
      expect(res.body.data.photos).toEqual({ kind: "notConfigured" });

      const place = await prisma.place.findUniqueOrThrow({
        where: { id: res.body.data.created.placeId },
      });
      expect(place).toMatchObject({
        name: "Gyeongbokgung",
        localName: "경복궁",
        externalRef: "osm:way/2",
        category: "landmark",
        lat: expect.closeTo(PALACE.lat + 0.0004, 3),
        city: "Seoul",
        isoCountryCode: "KR",
        visited: true,
      });
      const visit = await prisma.placeVisit.findUniqueOrThrow({
        where: { id: res.body.data.created.placeVisitId },
      });
      expect(visit).toMatchObject({
        placeId: place.id,
        tripId,
        visitedAtUtc: new Date("2026-05-01T05:10:00.000Z"),
        visitedZone: "Asia/Seoul",
        visitedPrecision: "minute",
        writtenVia: "suggestion",
      });
      expect(await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        status: "accepted",
        createdPlaceVisitId: visit.id,
      });
    });

    it("accepting again returns the same visit and creates nothing more", async () => {
      await scan();
      const [row] = await pending();
      const first = await accept(row.id);
      const second = await accept(row.id);
      expect(second.status).toBe(200);
      expect(second.body.data.created.placeVisitId).toBe(first.body.data.created.placeVisitId);
      expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
      expect(await prisma.place.count({ where: { userId } })).toBe(1);
    });

    it("reuses the own place with the same osm ref instead of minting a second one", async () => {
      const own = await prisma.place.create({
        data: { userId, name: "My Palace", lat: 37.57, lon: 126.98, externalRef: "osm:way/2" },
      });
      await scan();
      const [row] = await pending();
      const res = await accept(row.id);
      expect(res.body.data.created).toMatchObject({ placeId: own.id, placeCreated: false });
      expect(await prisma.place.count({ where: { userId } })).toBe(1);
      expect(await prisma.placeVisit.count({ where: { placeId: own.id, tripId } })).toBe(1);
    });

    it("takes the body's name over the suggested one", async () => {
      await scan();
      const [row] = await pending();
      const res = await accept(row.id, { name: "Gyeongbok Palace", localName: "경복궁" });
      const place = await prisma.place.findUniqueOrThrow({
        where: { id: res.body.data.created.placeId },
      });
      expect(place).toMatchObject({ name: "Gyeongbok Palace", localName: "경복궁" });
    });

    it("refuses to create a nameless place, and asks for a name", async () => {
      const nothing: PlaceNameGeocoder = {
        searchEnglish: async () => null,
        reverseEnglish: async () => [],
        reverseDefault: async () => [],
      };
      await scanPhotoJourneys(userId, { ...WINDOW, geocoder: nothing });
      const [row] = await pending();

      const refused = await accept(row.id);
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe("VISIT_NAME_REQUIRED");
      expect(await prisma.place.count({ where: { userId } })).toBe(0);
      expect((await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
        "pending"
      );

      const named = await accept(row.id, { name: "Palace Grounds" });
      expect(named.status).toBe(200);
      expect(named.body.data.created.placeCreated).toBe(true);
    });

    it("is a 404 for another user's finding", async () => {
      await scan();
      const [row] = await pending();
      const stranger = await prisma.user.create({
        data: { username: `pj-visit-other-${stamp}`, passwordHash: "x" },
      });
      const res = await request(app)
        .patch(`/api/v1/photo-journeys/${row.id}`)
        .set("Cookie", `auth_token=${generateToken(stranger.id)}`)
        .send({ status: "accepted" });
      expect(res.status).toBe(404);
      await prisma.user.delete({ where: { id: stranger.id } });
    });
  });
});
