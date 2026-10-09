import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /places/:id/related` — what a delete takes and leaves, and what a merge
 * moves (forgejo#232, forgejo#250). Before it, the delete question could name
 * the visits only: the list endpoint carries no photos, and documents were one
 * request per visit, so the question said nothing of either.
 */
const USERS = ["placerelated", "placerelatedother"];

describe("GET /places/:id/related", () => {
  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let otherUserId: string;

  const cleanup = async (): Promise<void> => {
    const where = { user: { username: { in: USERS } } };
    await prisma.document.deleteMany({ where });
    await prisma.placeList.deleteMany({ where });
    await prisma.placeVisit.deleteMany({ where });
    await prisma.place.deleteMany({ where });
    await prisma.trip.deleteMany({ where });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const o = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    otherUserId = o.id;
    otherCookie = `auth_token=${generateToken(o.id)}`;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("counts visits (planned apart), photos, documents, lists and trips", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Rom 2025" } });
    const place = await prisma.place.create({
      data: { userId, name: "Pantheon", lat: 41.8986, lon: 12.4769 },
    });
    const past = await prisma.placeVisit.create({
      data: { userId, placeId: place.id, tripId: trip.id, visitedAt: new Date("2025-04-02") },
    });
    await prisma.placeVisit.create({
      data: { userId, placeId: place.id, visitedAt: new Date("2099-01-01") },
    });
    await prisma.placeVisit.create({ data: { userId, placeId: place.id, visitedAt: null } });
    await prisma.placeVisitPhoto.createMany({
      data: [
        { placeVisitId: past.id, filename: "a.jpg", mimetype: "image/jpeg", sizeBytes: 1 },
        { placeVisitId: past.id, filename: "b.jpg", mimetype: "image/jpeg", sizeBytes: 1 },
      ],
    });
    await prisma.document.create({
      data: {
        userId,
        storedName: "ticket.pdf",
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: "x",
        format: "pdf",
        placeVisitId: past.id,
      },
    });
    for (const name of ["Rom", "Kuppeln"]) {
      const list = await prisma.placeList.create({ data: { userId, name } });
      await prisma.placeListEntry.create({ data: { listId: list.id, placeId: place.id } });
    }

    const res = await request(app).get(`/api/v1/places/${place.id}/related`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      visitCount: 3,
      plannedVisitCount: 1,
      photoCount: 2,
      documentCount: 1,
      lists: [
        { id: expect.any(String), name: "Kuppeln" },
        { id: expect.any(String), name: "Rom" },
      ],
      trips: [{ id: trip.id, name: "Rom 2025" }],
      roadtripStationCount: 0,
    });
  });

  it("answers zeros and empty lists for a bare place — never a missing figure", async () => {
    const place = await prisma.place.create({
      data: { userId, name: "Trevi", lat: 41.9009, lon: 12.4833 },
    });
    const res = await request(app).get(`/api/v1/places/${place.id}/related`).set("Cookie", cookie);
    expect(res.body.data).toMatchObject({
      visitCount: 0,
      photoCount: 0,
      documentCount: 0,
      lists: [],
      trips: [],
    });
  });

  it("answers 404 for another account's place, exactly as for a missing one", async () => {
    const foreign = await prisma.place.create({
      data: { userId: otherUserId, name: "Fremd", lat: 1, lon: 1 },
    });
    const res = await request(app)
      .get(`/api/v1/places/${foreign.id}/related`)
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
    const own = await request(app)
      .get(`/api/v1/places/${foreign.id}/related`)
      .set("Cookie", otherCookie);
    expect(own.status).toBe(200);
  });

  it("requires a session", async () => {
    const res = await request(app).get(
      "/api/v1/places/00000000-0000-0000-0000-000000000000/related"
    );
    expect(res.status).toBe(401);
  });
});
