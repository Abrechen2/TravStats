import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /photo-journeys` is bounded and totally ordered (fix/ct142-places): it
 * returned every finding of a status, and the nearest-visit lookup beside it
 * then scaled with that unbounded list.
 */
describe("GET /api/v1/photo-journeys is bounded", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `pj-bound-${Date.now()}`, passwordHash: "synthetic-test-hash" },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    // 501 findings; the first three share one start, so only the id orders them.
    await prisma.photoJourney.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({
        userId,
        fingerprint: `pj-bound-${i}`,
        startDate: new Date(Date.UTC(2024, 0, 1) + (i < 3 ? 0 : i) * 86_400_000),
        endDate: new Date(Date.UTC(2024, 0, 1) + (i < 3 ? 0 : i) * 86_400_000 + 3_600_000),
        photoCount: 5,
        locatedCount: 5,
        lat: 38.72,
        lon: -9.14,
        previewAssetIds: [],
        kind: "trip",
      })),
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("returns the newest 500, newest first, with the id breaking ties", async () => {
    const r = await request(app).get("/api/v1/photo-journeys").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(500);
    const starts = r.body.data.map((j: { startDate: string }) => j.startDate);
    expect(starts).toEqual([...starts].sort().reverse());
    const tied = r.body.data
      .filter((j: { startDate: string }) => j.startDate === "2024-01-01T00:00:00.000Z")
      .map((j: { id: string }) => j.id);
    expect(tied).toEqual([...tied].sort());
  });
});
