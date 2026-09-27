import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { mintWriteToken } from "../../shared/time/__tests__/patFixture";

/**
 * ADR 0002 phase 2 — a visit is written through `toInstant` with the PLACE's
 * zone, dual-written: `visitedAt` keeps the web meaning (the wall clock as
 * fake UTC), the new columns hold the instant, the zone, the precision and
 * who wrote the row. What the user sees on refusal is a code and a field.
 */
const USER = "placetimemodel";
// The Colosseum: Europe/Rome, +02:00 in July, +01:00 in winter.
const ROME = { name: "Kolosseum", category: "landmark", lat: 41.8902, lon: 12.4922 };

describe("Place visits — time model (phase 2)", () => {
  let userId: string;
  let cookie: string;
  let placeId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.apiToken.deleteMany({ where: { user: { username: USER } } });
    await prisma.placeVisit.deleteMany({ where: { user: { username: USER } } });
    await prisma.place.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    placeId = (await prisma.place.create({ data: { userId, ...ROME } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.placeVisit.deleteMany({ where: { userId } });
  });

  const post = (body: unknown, auth: { cookie?: string; bearer?: string } = { cookie }) => {
    const req = request(app).post(`/api/v1/places/${placeId}/visits`);
    if (auth.bearer) req.set("Authorization", auth.bearer);
    else req.set("Cookie", auth.cookie ?? cookie);
    return req.send(body);
  };

  it("stores the Rome wall clock as the instant, the zone and precision, and the legacy fake UTC", async () => {
    const res = await post({ visitedAt: { local: "2025-07-03T14:30" } });
    expect(res.status).toBe(201);
    const row = await prisma.placeVisit.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.visitedAt?.toISOString()).toBe("2025-07-03T14:30:00.000Z");
    expect(row.visitedAtUtc?.toISOString()).toBe("2025-07-03T12:30:00.000Z");
    expect(row.visitedZone).toBe("Europe/Rome");
    expect(row.visitedPrecision).toBe("minute");
    expect(row.writtenVia).toBe("web");
  });

  it("records a day-only visit at the place's midnight, precision day", async () => {
    const res = await post({ visitedAt: "2025-01-10" });
    expect(res.status).toBe(201);
    const row = await prisma.placeVisit.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.visitedAtUtc?.toISOString()).toBe("2025-01-09T23:00:00.000Z");
    expect(row.visitedPrecision).toBe("day");
  });

  it("refuses a wall clock the place's zone skips — 422 LOCAL_TIME_NONEXISTENT on visitedAt", async () => {
    const res = await post({ visitedAt: { local: "2027-03-28T02:30" } });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "LOCAL_TIME_NONEXISTENT", field: "visitedAt" });
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
  });

  it("takes the earlier repeated hour unless the client says fold: later", async () => {
    const earlier = await post({ visitedAt: { local: "2027-10-31T02:30" } });
    const later = await post({ visitedAt: { local: "2027-10-31T02:30", fold: "later" } });
    const rows = await prisma.placeVisit.findMany({
      where: { id: { in: [earlier.body.data.id, later.body.data.id] } },
    });
    const utcOf = (id: string) => rows.find((r) => r.id === id)?.visitedAtUtc?.toISOString();
    expect(utcOf(earlier.body.data.id)).toBe("2027-10-31T00:30:00.000Z");
    expect(utcOf(later.body.data.id)).toBe("2027-10-31T01:30:00.000Z");
  });

  it("refuses an offset-less string with TIME_SHAPE_REQUIRED", async () => {
    const res = await post({ visitedAt: "2025-07-03T14:30" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "visitedAt" });
  });

  it("refuses a bare ISO-Z from a browser session — a cached bundle sending fake UTC", async () => {
    const res = await post({ visitedAt: "2025-07-03T14:30:00.000Z" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "visitedAt" });
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
  });

  it("accepts a photo journey's own start from the browser — the inbox accept keeps working", async () => {
    // The web inbox creates the visit of an accepted photo journey with the
    // journey's start: an EXIF instant the server holds, not a fake-UTC clock.
    const start = new Date("2025-07-03T12:30:05.000Z");
    await prisma.photoJourney.create({
      data: {
        userId,
        placeId,
        kind: "place",
        startDate: start,
        endDate: new Date("2025-07-03T15:00:00.000Z"),
        photoCount: 4,
        locatedCount: 4,
        lat: ROME.lat,
        lon: ROME.lon,
        fingerprint: "time-model-test",
        previewAssetIds: [],
      },
    });
    try {
      const res = await post({ visitedAt: start.toISOString() });
      expect(res.status).toBe(201);
      const row = await prisma.placeVisit.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(row.visitedAtUtc?.toISOString()).toBe("2025-07-03T12:30:05.000Z");
      expect(row.visitedAt?.toISOString()).toBe("2025-07-03T14:30:05.000Z");
      expect(row.writtenVia).toBe("suggestion");
    } finally {
      await prisma.photoJourney.deleteMany({ where: { userId } });
    }
  });

  it("accepts the same ISO-Z from the Companion as the real instant it is", async () => {
    const bearer = await mintWriteToken(userId, { deviceId: "phone-1" });
    const res = await post({ visitedAt: "2025-07-03T12:30:00.000Z" }, { bearer });
    expect(res.status).toBe(201);
    const row = await prisma.placeVisit.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.visitedAtUtc?.toISOString()).toBe("2025-07-03T12:30:00.000Z");
    // The legacy column gets the web meaning, so it is no longer mixed.
    expect(row.visitedAt?.toISOString()).toBe("2025-07-03T14:30:00.000Z");
    expect(row.writtenVia).toBe("companion");
  });

  it("records a script's token as `api` and a PATCH re-derives the columns", async () => {
    const bearer = await mintWriteToken(userId);
    const created = await post({ visitedAt: "2025-07-03T12:30:00+00:00" }, { bearer });
    expect(created.status).toBe(201);
    const patched = await request(app)
      .patch(`/api/v1/places/visits/${created.body.data.id}`)
      .set("Cookie", cookie)
      .send({ visitedAt: { local: "2025-12-01T09:00" } });
    expect(patched.status).toBe(200);
    const row = await prisma.placeVisit.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(row.visitedAtUtc?.toISOString()).toBe("2025-12-01T08:00:00.000Z");
    expect(row.writtenVia).toBe("web");
  });
});
