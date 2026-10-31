import request from "supertest";
import { randomUUID } from "crypto";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as geo from "../../services/geo/nominatim";

/** Unnamed "Ort jetzt" positions held by the server until named (companion#90). */
describe("place captures", () => {
  let userId: string;
  let otherId: string;
  let cookie: string;
  let otherCookie: string;
  const base = "/api/v1/places/captures";
  const body = (over: object = {}) => ({
    clientId: randomUUID(),
    lat: 37.5665,
    lon: 126.978,
    accuracyM: 12.5,
    capturedAt: "2026-10-04T05:30:00.000Z",
    note: "Café",
    ...over,
  });
  const create = (payload: object = body(), c = cookie) =>
    request(app).post(base).set("Cookie", c).send(payload);
  const resolve = (id: string, payload: object, c = cookie) =>
    request(app).post(`${base}/${id}/resolve`).set("Cookie", c).send(payload);

  beforeAll(async () => {
    const passwordHash = await hashPassword("isolated-test-password");
    const mk = async (n: string) =>
      (await prisma.user.create({ data: { username: `cap_${n}_${Date.now()}`, passwordHash } })).id;
    userId = await mk("a");
    otherId = await mk("b");
    cookie = `auth_token=${generateToken(userId)}`;
    otherCookie = `auth_token=${generateToken(otherId)}`;
  });
  beforeEach(() => {
    jest.spyOn(geo, "completeAddressFromCoordinates").mockResolvedValue(null);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    for (const id of [userId, otherId]) {
      await prisma.placeCapture.deleteMany({ where: { userId: id } });
      await prisma.placeVisit.deleteMany({ where: { userId: id } });
      await prisma.place.deleteMany({ where: { userId: id } });
    }
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  it("stores a capture and answers a repeat of the same clientId with the first row (200)", async () => {
    const payload = body();
    const first = await create(payload).expect(201);
    expect(first.body.data).toMatchObject({
      clientId: payload.clientId,
      status: "open",
      placeId: null,
      visitId: null,
      accuracyM: 12.5,
      note: "Café",
      capturedAt: "2026-10-04T05:30:00.000Z",
    });
    const again = await create(payload).expect(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(await prisma.placeCapture.count({ where: { userId } })).toBe(1);
  });

  it("accepts a null accuracy and no note, and refuses out-of-range or malformed input", async () => {
    await create(body({ accuracyM: null, note: undefined })).expect(201);
    for (const bad of [
      body({ lat: 91 }),
      body({ lon: -181 }),
      body({ clientId: "nope" }),
      body({ capturedAt: "yesterday" }),
      { ...body(), accuracyM: undefined },
    ]) {
      const res = await create(bad).expect(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
    }
  });

  it("lists only the caller's open captures, newest first, bounded", async () => {
    const older = (await create(body({ capturedAt: "2026-10-01T00:00:00.000Z" }))).body.data;
    const newer = (await create(body({ capturedAt: "2026-10-02T00:00:00.000Z" }))).body.data;
    await create(body(), otherCookie);
    const dismissed = (await create()).body.data;
    await request(app).delete(`${base}/${dismissed.id}`).set("Cookie", cookie).expect(200);
    const res = await request(app).get(`${base}?status=open`).set("Cookie", cookie).expect(200);
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual([newer.id, older.id]);
    await request(app).get(`${base}?status=bogus`).set("Cookie", cookie).expect(400);

    await prisma.placeCapture.createMany({
      data: Array.from({ length: 205 }, () => ({
        userId,
        clientId: randomUUID(),
        lat: 1,
        lon: 1,
        capturedAt: new Date("2026-09-01T00:00:00Z"),
      })),
    });
    const big = await request(app).get(base).set("Cookie", cookie).expect(200);
    expect(big.body.data).toHaveLength(200);
  });

  it("a capture of another user is a 404 CAPTURE_NOT_FOUND for resolve and dismiss", async () => {
    const mine = (await create()).body.data;
    const r = await resolve(mine.id, { name: "X" }, otherCookie).expect(404);
    expect(r.body.code).toBe("CAPTURE_NOT_FOUND");
    const d = await request(app).delete(`${base}/${mine.id}`).set("Cookie", otherCookie);
    expect(d.status).toBe(404);
    expect(d.body.code).toBe("CAPTURE_NOT_FOUND");
    await resolve(randomUUID(), { name: "X" }).expect(404);
  });

  it("resolve with a name creates the place and a counted visit at capturedAt, in one go", async () => {
    const cap = (await create()).body.data;
    const res = await resolve(cap.id, { name: "Hof Café", category: "restaurant" }).expect(200);
    expect(res.body.data.status).toBe("resolved");
    const place = await prisma.place.findUniqueOrThrow({ where: { id: res.body.data.placeId } });
    expect(place).toMatchObject({
      userId,
      name: "Hof Café",
      category: "restaurant",
      visited: true,
    });
    expect(place.lat).toBeCloseTo(37.5665);
    const visit = await prisma.placeVisit.findUniqueOrThrow({
      where: { id: res.body.data.visitId },
    });
    expect(visit.placeId).toBe(place.id);
    expect(visit.visitedAtUtc?.toISOString()).toBe("2026-10-04T05:30:00.000Z");
  });

  it("resolve with an owned placeId reuses it and adds the visit; a foreign placeId is refused", async () => {
    const existing = await prisma.place.create({
      data: { userId, name: "Bestand", lat: 1, lon: 2, category: "other" },
    });
    const cap = (await create()).body.data;
    const res = await resolve(cap.id, { placeId: existing.id }).expect(200);
    expect(res.body.data.placeId).toBe(existing.id);
    expect(await prisma.place.count({ where: { userId } })).toBe(1);
    expect(await prisma.placeVisit.count({ where: { placeId: existing.id } })).toBe(1);

    const foreign = await prisma.place.create({
      data: { userId: otherId, name: "Fremd", lat: 1, lon: 2, category: "other" },
    });
    const cap2 = (await create()).body.data;
    await resolve(cap2.id, { placeId: foreign.id }).expect(404);
    expect((await prisma.placeCapture.findUniqueOrThrow({ where: { id: cap2.id } })).status).toBe(
      "open"
    );
  });

  it("resolve with {placeId, visitId} binds what the phone already wrote and creates nothing", async () => {
    const existing = await prisma.place.create({
      data: { userId, name: "Schon da", lat: 1, lon: 2, category: "other" },
    });
    const written = await prisma.placeVisit.create({
      data: { placeId: existing.id, userId, orderIdx: 0 },
    });
    const cap = (await create()).body.data;
    const res = await resolve(cap.id, { placeId: existing.id, visitId: written.id }).expect(200);
    expect(res.body.data).toMatchObject({
      status: "resolved",
      placeId: existing.id,
      visitId: written.id,
    });
    expect(await prisma.place.count({ where: { userId } })).toBe(1);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
  });

  it("refuses a visitId that is not that place's or not the caller's (400 VALIDATION_FAILED)", async () => {
    const mine = await prisma.place.create({
      data: { userId, name: "A", lat: 1, lon: 2, category: "other" },
    });
    const elsewhere = await prisma.place.create({
      data: { userId, name: "B", lat: 1, lon: 2, category: "other" },
    });
    const visitElsewhere = await prisma.placeVisit.create({
      data: { placeId: elsewhere.id, userId, orderIdx: 0 },
    });
    const theirPlace = await prisma.place.create({
      data: { userId: otherId, name: "C", lat: 1, lon: 2, category: "other" },
    });
    const theirVisit = await prisma.placeVisit.create({
      data: { placeId: theirPlace.id, userId: otherId, orderIdx: 0 },
    });
    const cap = (await create()).body.data;
    for (const payload of [
      { placeId: mine.id, visitId: visitElsewhere.id },
      { placeId: mine.id, visitId: theirVisit.id },
      { placeId: mine.id, visitId: randomUUID() },
      { visitId: visitElsewhere.id },
    ]) {
      const res = await resolve(cap.id, payload).expect(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
    }
    expect((await prisma.placeCapture.findUniqueOrThrow({ where: { id: cap.id } })).status).toBe(
      "open"
    );
  });

  it("refuses a resolve without a name or placeId", async () => {
    const cap = (await create()).body.data;
    const res = await resolve(cap.id, { category: "cafe" }).expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("a second resolve is a 409 CAPTURE_ALREADY_RESOLVED and creates no second place", async () => {
    const cap = (await create()).body.data;
    await resolve(cap.id, { name: "Einmal" }).expect(200);
    const again = await resolve(cap.id, { name: "Zweimal" }).expect(409);
    expect(again.body.code).toBe("CAPTURE_ALREADY_RESOLVED");
    expect(await prisma.place.count({ where: { userId } })).toBe(1);
    const concurrent = (await create()).body.data;
    const results = await Promise.all([
      resolve(concurrent.id, { name: "P" }),
      resolve(concurrent.id, { name: "Q" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.place.count({ where: { userId } })).toBe(2);
  });

  it("dismiss keeps the row as dismissed; dismissing or resolving it again is a 409", async () => {
    const cap = (await create()).body.data;
    const res = await request(app).delete(`${base}/${cap.id}`).set("Cookie", cookie).expect(200);
    expect(res.body.data.status).toBe("dismissed");
    expect(await prisma.placeCapture.count({ where: { userId } })).toBe(1);
    await request(app).delete(`${base}/${cap.id}`).set("Cookie", cookie).expect(409);
    const r = await resolve(cap.id, { name: "Zu spät" }).expect(409);
    expect(r.body.code).toBe("CAPTURE_ALREADY_RESOLVED");
  });
});
