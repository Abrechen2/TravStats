import * as fs from "fs";
import * as path from "path";

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getTripPhotoDir } from "../../middleware/upload";
import { seedRoadtripDemo } from "../../seedDemo/seedRoadtrips";

/**
 * The companion#14 done-criterion, against the roadtrip demo (forgejo#139):
 * a photo taken on 16.07. lands at the Stavanger station of the seeded Norway
 * roadtrip. A trip photo needs a trip, so the demo files the roadtrip under
 * its trip "Sommer in Norwegen" — before that, no station of it could take one.
 */
const USERNAME = "rt-demo-station-photo";
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

describe("the Norway demo roadtrip takes a photo at its Stavanger station", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    await seedRoadtripDemo(userId);
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
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  const norway = () =>
    prisma.tripRoute.findFirstOrThrow({
      where: { userId, name: "Demo: Norwegen mit dem Wohnmobil" },
      select: { id: true, tripId: true },
    });

  it("files the roadtrip under its trip, and a re-seed duplicates neither", async () => {
    await seedRoadtripDemo(userId);
    const trips = await prisma.trip.findMany({
      where: { userId, name: "Demo: Sommer in Norwegen" },
      select: { id: true },
    });
    const roadtrips = await prisma.tripRoute.count({
      where: { userId, name: "Demo: Norwegen mit dem Wohnmobil" },
    });
    expect(trips).toHaveLength(1);
    expect(roadtrips).toBe(1);
    expect((await norway()).tripId).toBe(trips[0].id);
  });

  it("lands a photo of 16.07. at Stavanger and counts it there", async () => {
    const { id: roadtripId, tripId } = await norway();
    expect(tripId).not.toBeNull();

    // The phone's view of that day names the station to offer the photo to.
    const day = await request(app)
      .get("/api/v1/roadtrips/active?date=2025-07-16")
      .set("Cookie", cookie);
    const stavanger = day.body.stations.find(
      (s: { id: string }) => s.id === day.body.todayStationId
    );
    expect(stavanger.title).toBe("Stavanger");
    expect(stavanger.photoCount).toBe(0);

    const upload = await request(app)
      .post(`/api/v1/trips/${tripId}/photos`)
      .set("Cookie", cookie)
      .field("stopId", stavanger.id)
      .attach("photos", PNG_1x1, { filename: "preikestolen.png", contentType: "image/png" });
    expect(upload.status).toBe(201);
    const photoId = upload.body.photos[0].id;
    const dated = await request(app)
      .patch(`/api/v1/trips/${tripId}/photos/${photoId}`)
      .set("Cookie", cookie)
      .send({ takenAt: "2025-07-16T10:30:00.000Z" });
    expect(dated.status).toBe(200);
    expect(dated.body.photo).toMatchObject({
      stopId: stavanger.id,
      takenAt: "2025-07-16T10:30:00.000Z",
    });

    const detail = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    const row = detail.body.stations.find((s: { id: string }) => s.id === stavanger.id);
    expect(row.photoCount).toBe(1);
  });
});
