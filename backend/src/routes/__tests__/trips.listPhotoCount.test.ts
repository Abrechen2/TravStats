import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#121 — the same N+1 as forgejo#90, one relation further. A gallery
 * badge beside each trip had to call GET /trips/:id/photos per row to learn
 * whether there was anything to show. `_count.photos` answers it in the list.
 *
 * Both kinds of row count: a photo imported into `getTripPhotoDir()` and one
 * that only links an Immich asset are the same relation, and a client showing
 * "12 photos" means both.
 */
describe("the trip list counts trip photos in _count.photos", () => {
  let authCookie: string;
  let userId: string;
  let tripWithPhotos: string;
  let tripWithout: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripPhotoCount" } });
    const user = await prisma.user.create({
      data: { username: "tripPhotoCount", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;

    const withPhotos = await prisma.trip.create({
      data: { userId, name: "Lisbon", status: "completed" },
    });
    tripWithPhotos = withPhotos.id;
    await prisma.tripPhoto.createMany({
      data: [
        { tripId: tripWithPhotos, filename: "alfama.jpg", mimetype: "image/jpeg", sizeBytes: 1024 },
        { tripId: tripWithPhotos, filename: "belem.jpg", mimetype: "image/jpeg", sizeBytes: 2048 },
        // Linked, not imported: no bytes on disk, still a photo of this trip.
        {
          tripId: tripWithPhotos,
          filename: "tram.jpg",
          mimetype: "image/jpeg",
          sizeBytes: 0,
          immichAssetId: "asset-tram-28",
        },
      ],
    });

    const without = await prisma.trip.create({
      data: { userId, name: "No pictures", status: "completed" },
    });
    tripWithout = without.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("counts imported and linked photos alike", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie);
    expect(res.status).toBe(200);

    const trip = res.body.trips.find((t: { id: string }) => t.id === tripWithPhotos);
    expect(trip).toBeDefined();
    expect(trip._count.photos).toBe(3);
  });

  it("reports zero, not an absent key, for a trip without photos", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie);
    const trip = res.body.trips.find((t: { id: string }) => t.id === tripWithout);
    expect(trip._count.photos).toBe(0);
  });
});
