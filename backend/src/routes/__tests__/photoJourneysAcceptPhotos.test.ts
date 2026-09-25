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
import { ImmichError } from "../../services/immich/types";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * Package 9, item 1: accepting a place finding brings its photographs along as
 * links. What these pin: only ids the caller's own Immich returns for the
 * journey's span are linked; a second accept adds nothing; a library that is
 * missing or down leaves the accept a success and writes no row.
 */
const PROVEN = "11111111-1111-4111-8111-111111111111";
const ALSO_PROVEN = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";
const CONNECTION = { baseUrl: "http://immich.test", apiKey: "k", source: "user" };

const asset = (id: string) => ({
  id,
  type: "IMAGE",
  fileCreatedAt: "2024-05-01T10:00:00.000Z",
  originalFileName: `${id}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 1234,
  lat: 38.72,
  lon: -9.14,
});

describe("accepting a place finding links its photographs", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let placeId: string;

  const journey = (previewAssetIds: string[]) =>
    prisma.photoJourney.create({
      data: {
        userId,
        fingerprint: `acc-${stamp}-${Math.random().toString(36).slice(2)}`,
        kind: "place",
        startDate: new Date("2024-05-01T09:00:00Z"),
        endDate: new Date("2024-05-01T18:00:00Z"),
        photoCount: previewAssetIds.length,
        locatedCount: previewAssetIds.length,
        lat: 38.72,
        lon: -9.14,
        previewAssetIds,
        placeId,
      },
    });

  const accept = (journeyId: string, visitId: string) =>
    request(app)
      .patch(`/api/v1/photo-journeys/${journeyId}`)
      .set("Cookie", cookie)
      .send({ status: "accepted", createdPlaceVisitId: visitId });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `pj-acc-${stamp}`, passwordHash } })).id;
    cookie = `auth_token=${generateToken(userId)}`;
    placeId = (
      await prisma.place.create({ data: { userId, name: "Miradouro", lat: 38.72, lon: -9.14 } })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  beforeEach(() => {
    searchAssetsByDate.mockReset();
    getImmichConnection.mockReset();
    getImmichConnection.mockResolvedValue(CONNECTION);
  });

  it("links the ids the library returns, skips the one it does not, and adds nothing twice", async () => {
    searchAssetsByDate.mockResolvedValue({
      assets: [asset(PROVEN), asset(ALSO_PROVEN)],
      truncated: false,
    });
    const row = await journey([PROVEN, FOREIGN, ALSO_PROVEN]);
    const visit = await prisma.placeVisit.create({ data: { userId, placeId } });

    const first = await accept(row.id, visit.id);
    expect(first.status).toBe(200);
    expect(first.body.data.photos).toEqual({ kind: "linked", linked: 2, skipped: 1 });

    const again = await accept(row.id, visit.id);
    expect(again.body.data.photos).toEqual({ kind: "linked", linked: 0, skipped: 1 });

    const photos = await prisma.placeVisitPhoto.findMany({
      where: { placeVisitId: visit.id },
      orderBy: { sortIdx: "asc" },
    });
    expect(photos.map((p) => p.immichAssetId)).toEqual([PROVEN, ALSO_PROVEN]);
    expect(photos.every((p) => p.filename === null)).toBe(true);
  });

  it("accepts without Immich and links nothing", async () => {
    getImmichConnection.mockResolvedValue(null);
    const row = await journey([PROVEN]);
    const visit = await prisma.placeVisit.create({ data: { userId, placeId } });

    const res = await accept(row.id, visit.id);
    expect(res.status).toBe(200);
    expect(res.body.data.photos).toEqual({ kind: "notConfigured" });
    expect(await prisma.placeVisitPhoto.count({ where: { placeVisitId: visit.id } })).toBe(0);
    expect((await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "accepted"
    );
  });

  it("accepts when Immich is down and says so", async () => {
    searchAssetsByDate.mockRejectedValue(new ImmichError("unreachable", "down"));
    const row = await journey([PROVEN]);
    const visit = await prisma.placeVisit.create({ data: { userId, placeId } });

    const res = await accept(row.id, visit.id);
    expect(res.status).toBe(200);
    expect(res.body.data.photos).toEqual({ kind: "failed", reason: "unreachable" });
    expect(await prisma.placeVisitPhoto.count({ where: { placeVisitId: visit.id } })).toBe(0);
  });

  it("links nothing on a dismissal", async () => {
    const row = await journey([PROVEN]);
    const res = await request(app)
      .patch(`/api/v1/photo-journeys/${row.id}`)
      .set("Cookie", cookie)
      .send({ status: "dismissed" });
    expect(res.status).toBe(200);
    expect(res.body.data.photos).toBeNull();
    expect(searchAssetsByDate).not.toHaveBeenCalled();
  });
});

/**
 * A trip finding's photographs stay on the journey row and are read through it:
 * a trip photo is a file and link mode is an album, and a finding has neither.
 */
describe("GET /api/v1/photo-journeys/for-trip/:tripId", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerCookie: string;
  let cookie: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `pj-ft-${stamp}`, passwordHash } })).id;
    const stranger = await prisma.user.create({
      data: { username: `pj-ft-other-${stamp}`, passwordHash },
    });
    cookie = `auth_token=${generateToken(userId)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: `pj-ft-` } } });
  });

  it("lists the accepted journeys that made the trip, and nothing to a stranger", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Lisboa" } });
    const make = (status: string, createdTripId: string | null) =>
      prisma.photoJourney.create({
        data: {
          userId,
          status,
          createdTripId,
          fingerprint: `ft-${stamp}-${Math.random().toString(36).slice(2)}`,
          startDate: new Date("2024-05-01T09:00:00Z"),
          endDate: new Date("2024-05-04T18:00:00Z"),
          photoCount: 3,
          locatedCount: 3,
          lat: 38.72,
          lon: -9.14,
          previewAssetIds: [PROVEN, ALSO_PROVEN],
        },
      });
    const made = await make("accepted", trip.id);
    await make("pending", trip.id);
    await make("accepted", null);

    const res = await request(app)
      .get(`/api/v1/photo-journeys/for-trip/${trip.id}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: made.id, previewCount: 2 }]);

    const stranger = await request(app)
      .get(`/api/v1/photo-journeys/for-trip/${trip.id}`)
      .set("Cookie", strangerCookie);
    expect(stranger.status).toBe(404);
  });
});
