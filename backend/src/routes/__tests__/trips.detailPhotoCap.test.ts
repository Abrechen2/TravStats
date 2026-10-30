import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { TRIP_PHOTO_LIST_CAP } from "../../services/trips/photoStation";

/**
 * GET /trips/:id included every photo with no `take`: an album of 5k photos was
 * a 5k-row payload on every trip open, while /trips/:id/photos capped at 1000.
 * The detail now caps the same way and says how many there really are
 * (forgejo#381).
 */
describe("GET /trips/:id caps the photo list", () => {
  let userId: string;
  let tripId: string;
  let cookie: string;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: {
        username: `photocap-${Date.now()}`,
        passwordHash: await hashPassword("pw-123456"),
        isActive: true,
      },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const trip = await prisma.trip.create({ data: { userId, name: "Big album" } });
    tripId = trip.id;
    const total = TRIP_PHOTO_LIST_CAP + 5;
    await prisma.tripPhoto.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        tripId,
        filename: `p${i}.jpg`,
        mimetype: "image/jpeg",
        sizeBytes: 1,
        sortIdx: i,
      })),
    });
    // The cover pseudo-photo must count as neither a photo nor towards the total.
    await prisma.tripPhoto.create({
      data: {
        tripId,
        filename: "c.jpg",
        mimetype: "image/jpeg",
        sizeBytes: 1,
        caption: "__cover__",
      },
    });
  });

  afterAll(async () => {
    await prisma.tripPhoto.deleteMany({ where: { tripId } });
    await prisma.trip.deleteMany({ where: { id: tripId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("returns at most the list cap and reports the true total", async () => {
    const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.trip.photos).toHaveLength(TRIP_PHOTO_LIST_CAP);
    expect(res.body.trip.photoCount).toBe(TRIP_PHOTO_LIST_CAP + 5);
    expect(res.body.trip.photosTruncated).toBe(true);
    expect(res.body.trip._count).toBeUndefined();
  });
});
