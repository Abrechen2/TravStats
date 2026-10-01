import * as fs from "fs";
import * as path from "path";

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getTripPhotoDir } from "../../middleware/upload";

/**
 * forgejo#139 — a roadtrip photo belongs to a STATION, linked for good.
 *
 * Matching a photo to a station by its date stores nothing and cannot tell
 * two stations on one day apart, so the link is a column (`TripPhoto.stopId`).
 * A foreign key proves the stop exists, not that it is on this trip — every
 * write path checks membership, and these tests aim at the refusals as much
 * as at the happy path: a link the server silently accepted to someone
 * else's stop would show their station in this trip's gallery.
 */
const USERS = ["photostation-owner", "photostation-stranger"];
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

// The smallest thing sharp will accept as an image: a real 1x1 PNG.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

describe("trip photos linked to a station (forgejo#139)", () => {
  let cookie: string;
  let userId: string;
  let tripId: string;
  let otherTripId: string;
  /** A plain timeline stop of the trip. */
  let timelineStopId: string;
  /** A station of a roadtrip filed on the trip — its own `tripId` is null. */
  let stavangerId: string;
  let bergenId: string;
  let roadtripId: string;
  /** A station of a roadtrip on no trip at all. */
  let standaloneStationId: string;
  let otherTripStopId: string;
  let strangerStopId: string;

  async function station(routeId: string, title: string, idx: number, start: string) {
    const s = await prisma.tripStop.create({
      data: {
        tripId: null,
        domain: "roadtrip",
        title,
        lat: 58.95,
        lon: 5.71,
        startDate: d(start),
        routeId,
        routeOrderIdx: idx,
        overnight: true,
      },
    });
    return s.id;
  }

  const upload = (trip: string, stopId?: string) => {
    const req = request(app).post(`/api/v1/trips/${trip}/photos`).set("Cookie", cookie);
    if (stopId !== undefined) req.field("stopId", stopId);
    return req.attach("photos", PNG_1x1, { filename: "fjord.png", contentType: "image/png" });
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const owner = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    userId = owner.id;
    cookie = `auth_token=${generateToken(userId)}`;
    const stranger = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });

    tripId = (await prisma.trip.create({ data: { userId, name: "Sommer in Norwegen" } })).id;
    otherTripId = (await prisma.trip.create({ data: { userId, name: "Lissabon" } })).id;
    timelineStopId = (
      await prisma.tripStop.create({ data: { tripId, title: "Oslo", startDate: d("2025-07-12") } })
    ).id;
    otherTripStopId = (
      await prisma.tripStop.create({ data: { tripId: otherTripId, title: "Alfama" } })
    ).id;

    roadtripId = (
      await prisma.tripRoute.create({
        data: { userId, tripId, kind: "roadtrip", name: "Norwegen", mode: "road", orderIdx: 0 },
      })
    ).id;
    stavangerId = await station(roadtripId, "Stavanger", 0, "2025-07-15");
    bergenId = await station(roadtripId, "Bergen", 1, "2025-07-17");

    const standalone = await prisma.tripRoute.create({
      data: { userId, tripId: null, kind: "roadtrip", name: "Allein", mode: "road", orderIdx: 1 },
    });
    standaloneStationId = await station(standalone.id, "Hirtshals", 0, "2025-07-14");

    const strangerTrip = await prisma.trip.create({
      data: { userId: stranger.id, name: "Fremd" },
    });
    strangerStopId = (
      await prisma.tripStop.create({ data: { tripId: strangerTrip.id, title: "Fremder Halt" } })
    ).id;
  });

  afterAll(async () => {
    const photos = await prisma.tripPhoto.findMany({
      where: { trip: { userId } },
      select: { filename: true },
    });
    for (const p of photos) {
      const file = path.join(getTripPhotoDir(), path.basename(p.filename));
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  describe("upload", () => {
    it("files every photo of the request at the roadtrip station it names", async () => {
      const res = await request(app)
        .post(`/api/v1/trips/${tripId}/photos`)
        .set("Cookie", cookie)
        .field("stopId", stavangerId)
        .attach("photos", PNG_1x1, { filename: "a.png", contentType: "image/png" })
        .attach("photos", PNG_1x1, { filename: "b.png", contentType: "image/png" });
      expect(res.status).toBe(201);
      expect(res.body.photos).toHaveLength(2);
      for (const p of res.body.photos) expect(p.stopId).toBe(stavangerId);

      const stored = await prisma.tripPhoto.findMany({
        where: { id: { in: res.body.photos.map((p: { id: string }) => p.id) } },
      });
      expect(stored.map((p) => p.stopId)).toEqual([stavangerId, stavangerId]);
    });

    it("accepts a stop of the trip's own timeline", async () => {
      const res = await upload(tripId, timelineStopId);
      expect(res.status).toBe(201);
      expect(res.body.photos[0].stopId).toBe(timelineStopId);
    });

    it("leaves stopId null when the request names none", async () => {
      const res = await upload(tripId);
      expect(res.status).toBe(201);
      expect(res.body.photos[0].stopId).toBeNull();
    });

    it.each([
      ["another trip's stop", () => otherTripStopId],
      ["another user's stop", () => strangerStopId],
      ["a station of a roadtrip filed on no trip", () => standaloneStationId],
      ["a stop that does not exist", () => "00000000-0000-4000-8000-000000000000"],
    ])("refuses %s with STOP_NOT_ON_TRIP and keeps no row or file", async (_label, stop) => {
      const before = await prisma.tripPhoto.count({ where: { tripId } });
      const filesBefore = fs.readdirSync(getTripPhotoDir()).length;

      const res = await upload(tripId, stop());
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("STOP_NOT_ON_TRIP");
      expect(res.body.field).toBe("stopId");

      expect(await prisma.tripPhoto.count({ where: { tripId } })).toBe(before);
      expect(fs.readdirSync(getTripPhotoDir()).length).toBe(filesBefore);
    });

    it("refuses a stopId that is not an id at all", async () => {
      const res = await upload(tripId, "stavanger");
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("PATCH", () => {
    let photoId: string;

    beforeAll(async () => {
      const res = await upload(tripId);
      photoId = res.body.photos[0].id;
    });

    const patch = (body: Record<string, unknown>) =>
      request(app)
        .patch(`/api/v1/trips/${tripId}/photos/${photoId}`)
        .set("Cookie", cookie)
        .send(body);

    it("moves a photo onto a station and off it again", async () => {
      const on = await patch({ stopId: bergenId });
      expect(on.status).toBe(200);
      expect(on.body.photo.stopId).toBe(bergenId);

      const off = await patch({ stopId: null });
      expect(off.status).toBe(200);
      expect(off.body.photo.stopId).toBeNull();
      expect((await prisma.tripPhoto.findUniqueOrThrow({ where: { id: photoId } })).stopId).toBe(
        null
      );
    });

    it("keeps the station when the body does not mention it", async () => {
      await patch({ stopId: bergenId });
      const res = await patch({ caption: "Bryggen" });
      expect(res.status).toBe(200);
      expect(res.body.photo.stopId).toBe(bergenId);
    });

    it("refuses another trip's stop and leaves the photo where it was", async () => {
      await patch({ stopId: bergenId });
      const res = await patch({ stopId: otherTripStopId });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("STOP_NOT_ON_TRIP");
      expect((await prisma.tripPhoto.findUniqueOrThrow({ where: { id: photoId } })).stopId).toBe(
        bergenId
      );
    });

    it("refuses another user's stop", async () => {
      const res = await patch({ stopId: strangerStopId });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("STOP_NOT_ON_TRIP");
    });
  });

  describe("read side", () => {
    it("filters the gallery to one station with ?stopId=", async () => {
      const res = await request(app)
        .get(`/api/v1/trips/${tripId}/photos?stopId=${stavangerId}`)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.photos.length).toBeGreaterThan(0);
      for (const p of res.body.photos) expect(p.stopId).toBe(stavangerId);

      const all = await request(app).get(`/api/v1/trips/${tripId}/photos`).set("Cookie", cookie);
      expect(all.body.photos.length).toBeGreaterThan(res.body.photos.length);
    });

    it("refuses a filter on a stop that is not on the trip rather than answering empty", async () => {
      const res = await request(app)
        .get(`/api/v1/trips/${tripId}/photos?stopId=${otherTripStopId}`)
        .set("Cookie", cookie);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("STOP_NOT_ON_TRIP");
    });

    it("carries stopId on the photos of GET /trips/:id", async () => {
      const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);
      expect(res.status).toBe(200);
      const atStavanger = res.body.trip.photos.filter(
        (p: { stopId: string | null }) => p.stopId === stavangerId
      );
      expect(atStavanger.length).toBe(2);
    });

    it("counts each station's photos on GET /roadtrips/:id, the cover row left out", async () => {
      // A cover is an internal pseudo-photo row; even one wrongly linked must
      // not show up as a station photo.
      await prisma.tripPhoto.create({
        data: {
          tripId,
          stopId: stavangerId,
          filename: "cover.png",
          mimetype: "image/png",
          sizeBytes: 1,
          sortIdx: -1,
          caption: "__cover__",
        },
      });
      const stavangerPhotos = await prisma.tripPhoto.count({
        // Not `NOT: { caption }` — SQL drops the NULL captions with it.
        where: { stopId: stavangerId, OR: [{ caption: null }, { caption: { not: "__cover__" } }] },
      });
      const bergenPhotos = await prisma.tripPhoto.count({ where: { stopId: bergenId } });

      const res = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
      expect(res.status).toBe(200);
      const byId = new Map(
        res.body.stations.map((s: { id: string; photoCount: number }) => [s.id, s.photoCount])
      );
      expect(byId.get(stavangerId)).toBe(stavangerPhotos);
      expect(stavangerPhotos).toBe(2);
      expect(byId.get(bergenId)).toBe(bergenPhotos);
    });

    it("reports zero, not an absent key, for a station without photos", async () => {
      const lone = await station(roadtripId, "Geiranger", 2, "2025-07-19");
      const res = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
      const row = res.body.stations.find((s: { id: string }) => s.id === lone);
      expect(row.photoCount).toBe(0);
    });
  });

  describe("lifecycle", () => {
    it("keeps the photo on the trip when its station is deleted", async () => {
      const doomed = await station(roadtripId, "Ålesund", 3, "2025-07-20");
      const res = await upload(tripId, doomed);
      const photoId = res.body.photos[0].id;

      await prisma.tripStop.delete({ where: { id: doomed } });

      const photo = await prisma.tripPhoto.findUnique({ where: { id: photoId } });
      expect(photo).not.toBeNull();
      expect(photo?.stopId).toBeNull();
      expect(photo?.tripId).toBe(tripId);
    });

    const filedAtStations = () =>
      prisma.tripPhoto.count({ where: { stop: { routeId: roadtripId } } });
    const move = (body: Record<string, unknown>) =>
      request(app).patch(`/api/v1/tours/${roadtripId}`).set("Cookie", cookie).send(body);

    it("refuses to move a roadtrip whose stations hold this trip's photos, saying how many and how to proceed", async () => {
      const filed = await filedAtStations();
      expect(filed).toBeGreaterThan(0);

      const res = await move({ tripId: otherTripId });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ROADTRIP_HAS_TRIP_PHOTOS");
      // The app asks the user with these two: how many, and the opt-in to send.
      expect(res.body.stationPhotos).toBe(filed);
      expect(res.body.optIn).toBe("detachStationPhotos");
      expect((await prisma.tripRoute.findUniqueOrThrow({ where: { id: roadtripId } })).tripId).toBe(
        tripId
      );
      expect(await filedAtStations()).toBe(filed);
    });

    it("refuses to detach it from its trip for the same reason", async () => {
      const res = await move({ tripId: null });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ROADTRIP_HAS_TRIP_PHOTOS");
    });

    it("refuses the opt-in without a move — it only ever accompanies one", async () => {
      const filed = await filedAtStations();
      const res = await move({ detachStationPhotos: true, name: "Norwegen" });
      expect(res.status).toBe(400);
      expect(await filedAtStations()).toBe(filed);
    });

    it("moves it with detachStationPhotos, taking the photos off their stations but not off the trip", async () => {
      const filed = await prisma.tripPhoto.findMany({
        where: { stop: { routeId: roadtripId } },
        select: { id: true },
      });
      const res = await move({ tripId: otherTripId, detachStationPhotos: true });
      expect(res.status).toBe(200);
      expect(res.body.route.tripId).toBe(otherTripId);
      expect(res.body.detachedStationPhotos).toBe(filed.length);

      const after = await prisma.tripPhoto.findMany({
        where: { id: { in: filed.map((p) => p.id) } },
      });
      expect(after).toHaveLength(filed.length);
      for (const p of after) {
        expect(p.stopId).toBeNull();
        expect(p.tripId).toBe(tripId);
      }
    });

    it("reports zero detached photos on a move that needed none", async () => {
      const res = await move({ tripId });
      expect(res.status).toBe(200);
      expect(res.body.detachedStationPhotos).toBe(0);
    });
  });
});
