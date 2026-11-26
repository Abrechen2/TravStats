import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { seedRoadtripDemo } from "../../seedDemo/seedRoadtrips";

/**
 * GET /roadtrips/:id/photos — the roadtrip's "Fotos" tab. Linked photos are the ones filed at
 * a station or stay; window photos are the trip's unfiled uploads that fit the days and the
 * route. Another account's photos and roadtrips never appear.
 */
const OWNER = "rt-photos-owner";
const OTHER = "rt-photos-other";

describe("GET /roadtrips/:id/photos", () => {
  let ownerId: string;
  let otherId: string;
  let ownerCookie: string;
  let otherCookie: string;
  let roadtripId: string;
  let tripId: string;
  let stationId: string;
  let anchor: { lat: number; lon: number; day: Date };

  const photo = (
    over: Partial<{
      tripId: string;
      stopId: string | null;
      lat: number | null;
      lon: number | null;
      takenAt: Date | null;
      caption: string;
    }>
  ) =>
    prisma.tripPhoto.create({
      data: {
        tripId,
        filename: "x.jpg",
        mimetype: "image/jpeg",
        sizeBytes: 1,
        stopId: null,
        lat: anchor.lat,
        lon: anchor.lon,
        takenAt: anchor.day,
        ...over,
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [OWNER, OTHER] } } });
    const [a, b] = await Promise.all(
      [OWNER, OTHER].map(async (username) =>
        prisma.user.create({
          data: { username, passwordHash: await hashPassword("password123") },
        })
      )
    );
    ownerId = a.id;
    otherId = b.id;
    ownerCookie = `auth_token=${generateToken(ownerId)}`;
    otherCookie = `auth_token=${generateToken(otherId)}`;
    await seedRoadtripDemo(ownerId);
    const route = await prisma.tripRoute.findFirstOrThrow({
      where: { userId: ownerId, kind: "roadtrip" },
      select: { id: true, tripId: true },
    });
    roadtripId = route.id;
    tripId = route.tripId!;
    const stop = await prisma.tripStop.findFirstOrThrow({
      where: { routeId: roadtripId, viaPoint: false, lat: { not: null }, startDate: { not: null } },
      orderBy: { routeOrderIdx: "asc" },
    });
    stationId = stop.id;
    anchor = { lat: stop.lat!, lon: stop.lon!, day: stop.startDate! };
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [OWNER, OTHER] } } });
    await prisma.$disconnect();
  });

  it("lists a photo filed at a station as linked, with its station and day", async () => {
    const filed = await photo({ stopId: stationId, caption: "filed" });
    const res = await request(app)
      .get(`/api/v1/roadtrips/${roadtripId}/photos`)
      .set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    const row = res.body.photos.find((p: { key: string }) => p.key === `upload:${filed.id}`);
    expect(row).toMatchObject({ kind: "linked", via: "station", stationId, caption: "filed" });
    expect(row.url).toBe(`/api/v1/trips/${tripId}/photos/${filed.id}/file`);
    expect(res.body.span).not.toBeNull();
  });

  it("offers an unfiled upload on the roadtrip's days near a station as a window photo", async () => {
    const near = await photo({ caption: "near" });
    const res = await request(app)
      .get(`/api/v1/roadtrips/${roadtripId}/photos`)
      .set("Cookie", ownerCookie);
    const row = res.body.photos.find((p: { key: string }) => p.key === `window:${near.id}`);
    expect(row).toMatchObject({ kind: "window", stationId, tripPhotoId: near.id, tripId });
  });

  it("leaves out photos that are too far, outside the days, or have no position", async () => {
    const far = await photo({ lat: anchor.lat + 5, caption: "far" });
    const early = await photo({ takenAt: new Date(anchor.day.getTime() - 60 * 86_400_000) });
    const nowhere = await photo({ lat: null, lon: null });
    const res = await request(app)
      .get(`/api/v1/roadtrips/${roadtripId}/photos`)
      .set("Cookie", ownerCookie);
    const keys = res.body.photos.map((p: { key: string }) => p.key);
    for (const p of [far, early, nowhere]) expect(keys).not.toContain(`window:${p.id}`);
  });

  it("never shows another account's photos, and 404s a roadtrip that is not yours", async () => {
    const stranger = await prisma.trip.create({ data: { userId: otherId, name: "theirs" } });
    const theirs = await prisma.tripPhoto.create({
      data: {
        tripId: stranger.id,
        filename: "y.jpg",
        mimetype: "image/jpeg",
        sizeBytes: 1,
        lat: anchor.lat,
        lon: anchor.lon,
        takenAt: anchor.day,
        stopId: stationId,
      },
    });
    const mine = await request(app)
      .get(`/api/v1/roadtrips/${roadtripId}/photos`)
      .set("Cookie", ownerCookie);
    const keys = mine.body.photos.map((p: { key: string }) => p.key);
    expect(keys).not.toContain(`upload:${theirs.id}`);
    expect(keys).not.toContain(`window:${theirs.id}`);

    const foreign = await request(app)
      .get(`/api/v1/roadtrips/${roadtripId}/photos`)
      .set("Cookie", otherCookie);
    expect(foreign.status).toBe(404);
  });

  it("lists a library link on a station with its large-preview route", async () => {
    const link = await prisma.entryPhotoLink.create({
      data: {
        userId: ownerId,
        tripStopId: stationId,
        provider: "photoprism",
        assetId: "uid1",
        takenAt: anchor.day,
      },
    });
    const res = await request(app)
      .get(`/api/v1/roadtrips/${roadtripId}/photos`)
      .set("Cookie", ownerCookie);
    const row = res.body.photos.find((p: { key: string }) => p.key === `link:${link.id}`);
    expect(row).toMatchObject({ kind: "linked", source: "photoprism", via: "station" });
    expect(row.url).toBe(`/api/v1/entry-photos/roadtripStop/${stationId}/photos/${link.id}/file`);
  });
});
