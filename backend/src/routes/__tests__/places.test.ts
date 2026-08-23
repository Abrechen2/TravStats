import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const USERS = ["placetest", "placeother"];

describe("Places API", () => {
  let authCookie: string;
  let otherCookie: string;
  let userId: string;
  let otherUserId: string;
  let tripId: string;
  let otherTripId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.placeVisit.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.place.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.trip.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
    otherCookie = `auth_token=${generateToken(other.id)}`;

    tripId = (await prisma.trip.create({ data: { userId, name: "Rom 2025" } })).id;
    otherTripId = (await prisma.trip.create({ data: { userId: otherUserId, name: "Fremd" } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.placeVisit.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.place.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  });

  const create = (body: Record<string, unknown>, cookie = authCookie) =>
    request(app).post("/api/v1/places").set("Cookie", cookie).send(body);

  const BASE = { name: "Kolosseum", category: "landmark", lat: 41.8902, lon: 12.4922 };

  describe("creation", () => {
    it("requires coordinates — a place that cannot be drawn defeats the domain", async () => {
      const res = await create({ name: "Nirgendwo", category: "other" });
      expect(res.status).toBe(400);
    });

    it("defaults `visited` to FALSE, unlike Lodging", async () => {
      // The dominant creation path is 'add a target to a list'. A wishlist
      // entry silently counted as visited would inflate the headline number on
      // day one, so the "I was here" path has to say so explicitly.
      const res = await create(BASE);
      expect(res.status).toBe(201);
      expect(res.body.data.visited).toBe(false);
      expect(res.body.data.visitCount).toBe(0);
    });

    it("derives isoCountryCode from the free-text country", async () => {
      const res = await create({ ...BASE, country: "Italien" });
      expect(res.body.data.country).toBe("Italien");
      expect(res.body.data.isoCountryCode).toBe("IT");
    });

    it("dedups on externalRef instead of creating a second pin", async () => {
      const first = await create({ ...BASE, externalRef: "osm:node/123" });
      expect(first.status).toBe(201);
      const second = await create({ ...BASE, name: "Colosseum", externalRef: "osm:node/123" });
      expect(second.status).toBe(200);
      expect(second.body.deduped).toBe(true);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(await prisma.place.count({ where: { userId } })).toBe(1);
    });

    it("does not let one user's externalRef block another's", async () => {
      await create({ ...BASE, externalRef: "osm:node/123" });
      const mine = await create({ ...BASE, externalRef: "osm:node/123" }, otherCookie);
      expect(mine.status).toBe(201);
    });
  });

  describe("visits and the counting rule", () => {
    let placeId: string;
    beforeEach(async () => {
      placeId = (await create(BASE)).body.data.id;
    });

    const addVisit = (body: Record<string, unknown>, cookie = authCookie) =>
      request(app).post(`/api/v1/places/${placeId}/visits`).set("Cookie", cookie).send(body);

    it("recording a visit promotes the place out of the wishlist", async () => {
      // Leaving `visited` untouched here is the silent-wrong-count bug: it is
      // invisible until a headline figure is wrong, so it is pinned.
      const res = await addVisit({ visitedAt: "2025-05-03T14:30:00.000Z" });
      expect(res.status).toBe(201);
      const place = await request(app).get(`/api/v1/places/${placeId}`).set("Cookie", authCookie);
      expect(place.body.data.visited).toBe(true);
      expect(place.body.data.visitCount).toBe(1);
    });

    it("keeps the time of day — that is #175", async () => {
      const res = await addVisit({ visitedAt: "2025-05-03T14:30:00.000Z" });
      expect(new Date(res.body.data.visitedAt).toISOString()).toBe("2025-05-03T14:30:00.000Z");
    });

    it("counts an UNDATED visit — nobody enters a plan without a date", async () => {
      await addVisit({ visitedAt: null });
      const place = await request(app).get(`/api/v1/places/${placeId}`).set("Cookie", authCookie);
      expect(place.body.data.visitCount).toBe(1);
      expect(place.body.data.plannedVisitCount).toBe(0);
      expect(place.body.data.lastVisitAt).toBeNull();
    });

    it("a future-dated visit does NOT promote the place — a plan is not a visit", async () => {
      // The counterpart to the promotion test above, and the case that made
      // the wishlist/planned/visited distinction unusable: entering a plan
      // marked the place "Besucht" on the spot, so a place nobody had been to
      // sat in the visited count. The rule is `classifyVisit`, the same one
      // that already keeps future visits out of every figure.
      const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      await addVisit({ visitedAt: future });
      const place = await request(app).get(`/api/v1/places/${placeId}`).set("Cookie", authCookie);
      expect(place.body.data.visited).toBe(false);
      expect(place.body.data.plannedVisitCount).toBe(1);
    });

    it("moving a planned visit into the past promotes the place", async () => {
      const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      const created = await addVisit({ visitedAt: future });
      await request(app)
        .patch(`/api/v1/places/visits/${created.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ visitedAt: "2024-03-01T09:00:00.000Z" });
      const place = await request(app).get(`/api/v1/places/${placeId}`).set("Cookie", authCookie);
      expect(place.body.data.visited).toBe(true);
      expect(place.body.data.visitCount).toBe(1);
    });

    it("never demotes a place — the flag is one-directional", async () => {
      // A place may be visited with no dated visit at all ("I have been to
      // that Maccis, no idea when"). Recomputing the flag from the visits
      // would erase exactly that, so moving the only visit into the FUTURE
      // must leave `visited` alone.
      const created = await addVisit({ visitedAt: "2024-03-01T09:00:00.000Z" });
      const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      await request(app)
        .patch(`/api/v1/places/visits/${created.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ visitedAt: future });
      const place = await request(app).get(`/api/v1/places/${placeId}`).set("Cookie", authCookie);
      expect(place.body.data.visited).toBe(true);
      expect(place.body.data.visitCount).toBe(0);
    });

    it("does NOT count a future-dated visit", async () => {
      const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      await addVisit({ visitedAt: future });
      const place = await request(app).get(`/api/v1/places/${placeId}`).set("Cookie", authCookie);
      expect(place.body.data.visitCount).toBe(0);
      expect(place.body.data.plannedVisitCount).toBe(1);
      expect(place.body.data.lastVisitAt).toBeNull();
    });

    it("keeps ONE place with several visits — the whole point of #177", async () => {
      await addVisit({ visitedAt: "2024-06-12T10:00:00.000Z" });
      await addVisit({ visitedAt: "2025-05-03T16:00:00.000Z" });
      await addVisit({ visitedAt: "2023-01-01T09:00:00.000Z" });
      expect(await prisma.place.count({ where: { userId } })).toBe(1);
      const place = await request(app).get(`/api/v1/places/${placeId}`).set("Cookie", authCookie);
      expect(place.body.data.visitCount).toBe(3);
      // lastVisitAt is the most recent COMPLETED visit, not the last written.
      expect(new Date(place.body.data.lastVisitAt).toISOString()).toBe("2025-05-03T16:00:00.000Z");
    });

    it("deleting the last visit does not un-visit the place", async () => {
      // Removing a wrong date is not the statement 'I was never here'.
      const visit = await addVisit({ visitedAt: "2025-05-03T14:30:00.000Z" });
      await request(app)
        .delete(`/api/v1/places/visits/${visit.body.data.id}`)
        .set("Cookie", authCookie)
        .expect(200);
      const place = await request(app).get(`/api/v1/places/${placeId}`).set("Cookie", authCookie);
      expect(place.body.data.visited).toBe(true);
      expect(place.body.data.visitCount).toBe(0);
    });

    it("refuses to attach a visit to someone else's trip", async () => {
      const res = await addVisit({ tripId: otherTripId });
      expect(res.status).toBe(404);
    });

    it("accepts the owner's own trip", async () => {
      const res = await addVisit({ tripId, visitedAt: "2025-05-03T14:30:00.000Z" });
      expect(res.status).toBe(201);
      expect(res.body.data.tripId).toBe(tripId);
    });
  });

  describe("ownership", () => {
    it("never exposes another user's place", async () => {
      const mine = await create(BASE);
      const id = mine.body.data.id;
      await request(app).get(`/api/v1/places/${id}`).set("Cookie", otherCookie).expect(404);
      await request(app)
        .patch(`/api/v1/places/${id}`)
        .set("Cookie", otherCookie)
        .send({ name: "Hijacked" })
        .expect(404);
      await request(app).delete(`/api/v1/places/${id}`).set("Cookie", otherCookie).expect(404);
    });

    it("requires authentication", async () => {
      await request(app).get("/api/v1/places").expect(401);
    });
  });

  describe("listing", () => {
    it("filters by visited state and by category", async () => {
      await create({ ...BASE, visited: true });
      await create({ ...BASE, name: "Machu Picchu", lat: -13.16, lon: -72.54, visited: false });
      await create({ ...BASE, name: "Maccis", category: "restaurant", visited: true });

      const visited = await request(app)
        .get("/api/v1/places?visited=true")
        .set("Cookie", authCookie);
      expect(visited.body.data).toHaveLength(2);

      const wishlist = await request(app)
        .get("/api/v1/places?visited=false")
        .set("Cookie", authCookie);
      expect(wishlist.body.data).toHaveLength(1);
      expect(wishlist.body.data[0].name).toBe("Machu Picchu");

      const food = await request(app)
        .get("/api/v1/places?category=restaurant")
        .set("Cookie", authCookie);
      expect(food.body.data).toHaveLength(1);
    });

    it("reports the total so the client can page the complete set", async () => {
      await create(BASE);
      await create({ ...BASE, name: "Zweiter", lat: 1, lon: 1 });
      const res = await request(app)
        .get("/api/v1/places?limit=1")
        .set("Cookie", authCookie);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(2);
    });
  });
});
