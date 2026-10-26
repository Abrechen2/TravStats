import request from "supertest";
import app from "../../index";
import { observeQueries, prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /places/:id` carries a `documentCount` on every visit. The place page's
 * visit list shows "2 Dokumente" on each row without opening it, and before
 * this the only document figure was the per-place total from `/related` — the
 * page mounted a documents section, and with it a request, per visit instead.
 */
const USERS = ["placevisitdocs", "placevisitdocsother"];

describe("GET /places/:id — documentCount per visit", () => {
  let cookie: string;
  let userId: string;
  let otherUserId: string;

  const cleanup = async (): Promise<void> => {
    const where = { user: { username: { in: USERS } } };
    await prisma.document.deleteMany({ where });
    await prisma.placeVisit.deleteMany({ where });
    await prisma.place.deleteMany({ where });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  };

  const doc = (owner: string, placeVisitId: string, name: string) =>
    prisma.document.create({
      data: {
        userId: owner,
        storedName: name,
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: name,
        format: "pdf",
        placeVisitId,
      },
    });

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
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("counts each visit's own documents, zero included, in one grouped query", async () => {
    const place = await prisma.place.create({
      data: { userId, name: "Curt-Frenzel-Stadion", lat: 48.3738, lon: 10.8865 },
    });
    const two = await prisma.placeVisit.create({
      data: { userId, placeId: place.id, visitedAt: new Date("2026-02-27T13:30:00Z") },
    });
    const one = await prisma.placeVisit.create({
      data: { userId, placeId: place.id, visitedAt: new Date("2099-11-06T19:30:00Z") },
    });
    const none = await prisma.placeVisit.create({
      data: { userId, placeId: place.id, visitedAt: null },
    });
    await doc(userId, two.id, "a.pdf");
    await doc(userId, two.id, "b.pdf");
    await doc(userId, one.id, "ticket.pdf");
    // Another account's row pointing at this visit is not this user's document.
    await doc(otherUserId, none.id, "foreign.pdf");

    const documentQueries: string[] = [];
    const stop = observeQueries((q) => {
      if (q.model === "Document") documentQueries.push(q.operation);
    });
    let res;
    try {
      res = await request(app).get(`/api/v1/places/${place.id}`).set("Cookie", cookie);
    } finally {
      stop();
    }

    expect(res.status).toBe(200);
    const counts = Object.fromEntries(
      (res.body.data.visits as Array<{ id: string; documentCount: number }>).map((v) => [
        v.id,
        v.documentCount,
      ])
    );
    expect(counts).toEqual({ [two.id]: 2, [one.id]: 1, [none.id]: 0 });
    // One grouped query for all three visits, never one per visit.
    expect(documentQueries).toEqual(["groupBy"]);
  });

  it("answers an empty visit list without asking for documents", async () => {
    const place = await prisma.place.create({
      data: { userId, name: "Wunschort", lat: 48.37, lon: 10.89 },
    });
    const documentQueries: string[] = [];
    const stop = observeQueries((q) => {
      if (q.model === "Document") documentQueries.push(q.operation);
    });
    let res;
    try {
      res = await request(app).get(`/api/v1/places/${place.id}`).set("Cookie", cookie);
    } finally {
      stop();
    }
    expect(res.status).toBe(200);
    expect(res.body.data.visits).toEqual([]);
    expect(documentQueries).toEqual([]);
  });
});
