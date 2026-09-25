import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";

/**
 * Rail journeys (spec docs/superpowers/specs/2026-09-25-rail-domain.md).
 * The two rules worth the most here are the ones a client cannot see: whose
 * clock a time is read on, and whose row a request may touch.
 */

const FRANKFURT = { name: "Frankfurt (Main) Hbf", lat: 50.1071, lon: 8.6632, country: "de" };
const PARIS = { name: "Paris Est", lat: 48.8768, lon: 2.3591, country: "FR" };
const LONDON = { name: "London St Pancras", lat: 51.5319, lon: -0.1263, country: "GB" };

describe("Rail journeys API", () => {
  let cookie: string;
  let userId: string;
  let otherCookie: string;
  let otherUserId: string;

  const create = (body: Record<string, unknown>, as = cookie) =>
    request(app).post("/api/v1/rail").set("Cookie", as).send(body);

  const base = {
    operator: "DB Fernverkehr",
    trainCategory: "ICE",
    trainNumber: "9557",
    departureStation: FRANKFURT,
    arrivalStation: PARIS,
    departureLocal: "2026-07-01T08:15",
    arrivalLocal: "2026-07-01T12:09",
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["railtest", "railother"] } } });
    const user = await prisma.user.create({
      data: { username: "railtest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const other = await prisma.user.create({
      data: { username: "railother", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
    otherCookie = `auth_token=${generateToken(other.id)}`;
  });

  afterEach(async () => {
    await prisma.railJourney.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    // The creation bucket is per user and per hour; each test starts full so a
    // long suite does not read as "rate limited" half way through.
    await railCreationLimiter.resetKey(`user:${userId}`);
    await railCreationLimiter.resetKey(`user:${otherUserId}`);
  });

  it("limits creation per user, on its own bucket", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await create({ ...base, departureLocal: "2020-01-01T08:00" })).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses[20]).toBe(429);
    // The other account's bucket is untouched.
    expect((await create(base, otherCookie)).status).toBe(201);
  });

  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.companion.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/rail");
    expect(res.status).toBe(401);
  });

  describe("POST /api/v1/rail", () => {
    it("reads each time on its own station's clock", async () => {
      // 08:15 in Frankfurt (CEST, UTC+2) is 06:15 UTC; 12:09 in Paris is 10:09 UTC.
      const res = await create(base);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const row = res.body.data;
      expect(row.departureTime).toBe("2026-07-01T06:15:00.000Z");
      expect(row.arrivalTime).toBe("2026-07-01T10:09:00.000Z");
      expect(row.depTimezone).toBe("Europe/Berlin");
      expect(row.arrTimezone).toBe("Europe/Paris");
      expect(row.depCountry).toBe("DE");
    });

    it("accepts an arrival whose wall clock reads earlier than the departure's", async () => {
      // Paris 10:00 → London 10:55 is a two-hour train; a wall-clock compare
      // would have refused a later arrival that merely LOOKS early, and would
      // have let a genuinely earlier one through.
      const ok = await create({
        ...base,
        departureStation: PARIS,
        arrivalStation: LONDON,
        departureLocal: "2026-07-01T10:00",
        arrivalLocal: "2026-07-01T10:55",
      });
      expect(ok.status).toBe(201);
      expect(ok.body.data.arrivalTime).toBe("2026-07-01T09:55:00.000Z");

      const wrong = await create({
        ...base,
        departureStation: PARIS,
        arrivalStation: LONDON,
        departureLocal: "2026-07-01T10:00",
        arrivalLocal: "2026-07-01T08:30",
      });
      expect(wrong.status).toBe(400);
    });

    it("measures the great-circle distance and says that it did", async () => {
      const res = await create(base);
      expect(res.body.data.distanceSource).toBe("great_circle");
      expect(res.body.data.distanceKm).toBeGreaterThan(470);
      expect(res.body.data.distanceKm).toBeLessThan(485);
    });

    it("draws a hand-entered journey as a straight line and claims no actual times", async () => {
      const res = await create(base);
      expect(res.body.data.geometry).toBeNull();
      expect(res.body.data.geometrySource).toBe("straight");
      expect(res.body.data.actualArrivalTime).toBeNull();
      expect(res.body.data.lookupProvider).toBeNull();
    });

    it("does not let a client write a looked-up trip or a line it did not fetch", async () => {
      const res = await create({ ...base, geometrySource: "transitous", lookupProvider: "x" });
      expect(res.status).toBe(201);
      expect(res.body.data.geometrySource).toBe("straight");
      expect(res.body.data.lookupProvider).toBeNull();
    });

    it("keeps a distance the user typed", async () => {
      const res = await create({ ...base, distanceKm: 573 });
      expect(res.body.data.distanceKm).toBe(573);
      expect(res.body.data.distanceSource).toBe("user");
    });

    it("derives the status from the clock and keeps only a cancellation", async () => {
      const past = await create({
        ...base,
        departureLocal: "2020-01-01T08:00",
        arrivalLocal: "2020-01-01T12:00",
      });
      expect(past.body.data.status).toBe("completed");
      const future = await create({
        ...base,
        departureLocal: "2099-01-01T08:00",
        arrivalLocal: "2099-01-01T12:00",
      });
      expect(future.body.data.status).toBe("scheduled");
      const cancelled = await create({
        ...base,
        departureLocal: "2020-01-01T08:00",
        status: "cancelled",
      });
      expect(cancelled.body.data.status).toBe("cancelled");
    });

    it("refuses a status only the clock may set", async () => {
      const res = await create({ ...base, status: "completed" });
      expect(res.status).toBe(400);
    });

    it("refuses a time with an offset — the station decides the zone", async () => {
      const res = await create({ ...base, departureLocal: "2026-07-01T08:15:00+02:00" });
      expect(res.status).toBe(400);
    });

    it("refuses a station without coordinates", async () => {
      const res = await create({ ...base, departureStation: { name: "Somewhere" } });
      expect(res.status).toBe(400);
    });

    it("links companions through the join table and the legacy array alike", async () => {
      const res = await create({ ...base, companions: ["Anna", " Ben "] });
      expect(res.body.data.companions).toEqual(["Anna", "Ben"]);
      const links = await prisma.railJourneyCompanion.findMany({
        where: { railJourneyId: res.body.data.id },
        orderBy: { position: "asc" },
        include: { companion: true },
      });
      expect(links.map((l) => l.companion.displayName)).toEqual(["Anna", "Ben"]);

      const listed = await request(app).get("/api/v1/companions").set("Cookie", cookie);
      const anna = listed.body.companions.find((c: { name: string }) => c.name === "Anna");
      expect(anna.usageCount).toBe(1);
    });

    it("files a journey under the user's own trip, and refuses a stranger's", async () => {
      const own = await prisma.trip.create({ data: { userId, name: "Paris weekend" } });
      const foreign = await prisma.trip.create({ data: { userId: otherUserId, name: "Not mine" } });

      const ok = await create({ ...base, tripId: own.id });
      expect(ok.status).toBe(201);
      expect(ok.body.data.trip).toMatchObject({ id: own.id, name: "Paris weekend" });

      const refused = await create({ ...base, tripId: foreign.id });
      expect(refused.status).toBe(404);
    });
  });

  describe("GET /api/v1/rail", () => {
    it("lists only the caller's journeys, newest departure first, with a total", async () => {
      await create({ ...base, departureLocal: "2026-01-01T08:00", arrivalLocal: null });
      await create({ ...base, departureLocal: "2026-03-01T08:00", arrivalLocal: null });
      await create(base, otherCookie);

      const res = await request(app).get("/api/v1/rail").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ total: 2, offset: 0 });
      expect(res.body.data.map((r: { userId: string }) => r.userId)).toEqual([userId, userId]);
      expect(res.body.data[0].departureTime > res.body.data[1].departureTime).toBe(true);
    });

    it("pages and filters in the query", async () => {
      await create({ ...base, departureLocal: "2025-05-01T08:00", arrivalLocal: null });
      await create({
        ...base,
        trainCategory: "TGV",
        departureLocal: "2026-05-01T08:00",
        arrivalLocal: null,
      });

      const page = await request(app).get("/api/v1/rail?limit=1&offset=1").set("Cookie", cookie);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta.total).toBe(2);

      const tgv = await request(app).get("/api/v1/rail?q=tgv").set("Cookie", cookie);
      expect(tgv.body.data).toHaveLength(1);
      const year = await request(app).get("/api/v1/rail?year=2025").set("Cookie", cookie);
      expect(year.body.data).toHaveLength(1);
    });
  });

  describe("single journey", () => {
    it("answers 404 for a stranger's journey on read, update and delete", async () => {
      const foreign = await create(base, otherCookie);
      const id = foreign.body.data.id;
      expect((await request(app).get(`/api/v1/rail/${id}`).set("Cookie", cookie)).status).toBe(404);
      expect(
        (await request(app).patch(`/api/v1/rail/${id}`).set("Cookie", cookie).send({ seat: "1" }))
          .status
      ).toBe(404);
      expect((await request(app).delete(`/api/v1/rail/${id}`).set("Cookie", cookie)).status).toBe(
        404
      );
      expect(await prisma.railJourney.count({ where: { id } })).toBe(1);
    });

    it("keeps the ticket's wall clock when a station moves to another zone", async () => {
      const created = await create({ ...base, arrivalLocal: null });
      const id = created.body.data.id;
      // Still "08:15" on the ticket, now read on London's clock (BST, UTC+1).
      const res = await request(app)
        .patch(`/api/v1/rail/${id}`)
        .set("Cookie", cookie)
        .send({ departureStation: LONDON });
      expect(res.status).toBe(200);
      expect(res.body.data.departureTime).toBe("2026-07-01T07:15:00.000Z");
      expect(res.body.data.depTimezone).toBe("Europe/London");
    });

    it("re-measures the distance when a station moves, unless the user typed it", async () => {
      const measured = await create(base);
      const moved = await request(app)
        .patch(`/api/v1/rail/${measured.body.data.id}`)
        .set("Cookie", cookie)
        .send({ arrivalStation: LONDON });
      expect(moved.body.data.distanceKm).toBeGreaterThan(600);

      const typed = await create({ ...base, distanceKm: 573 });
      const kept = await request(app)
        .patch(`/api/v1/rail/${typed.body.data.id}`)
        .set("Cookie", cookie)
        .send({ arrivalStation: LONDON });
      expect(kept.body.data.distanceKm).toBe(573);

      const cleared = await request(app)
        .patch(`/api/v1/rail/${typed.body.data.id}`)
        .set("Cookie", cookie)
        .send({ distanceKm: null });
      expect(cleared.body.data.distanceSource).toBe("great_circle");
    });

    it("refuses a one-field update that puts the arrival before the stored departure", async () => {
      const created = await create(base);
      const res = await request(app)
        .patch(`/api/v1/rail/${created.body.data.id}`)
        .set("Cookie", cookie)
        .send({ arrivalLocal: "2026-07-01T07:00" });
      expect(res.status).toBe(400);
    });

    it("does not reset fields the update did not name", async () => {
      const created = await create({ ...base, status: "cancelled", seat: "45" });
      const res = await request(app)
        .patch(`/api/v1/rail/${created.body.data.id}`)
        .set("Cookie", cookie)
        .send({ notes: "window" });
      expect(res.body.data.status).toBe("cancelled");
      expect(res.body.data.seat).toBe("45");
      expect(res.body.data.notes).toBe("window");
    });

    it("replaces the companion list and clears an emptied text field", async () => {
      const created = await create({ ...base, companions: ["Anna"], coach: "7" });
      const res = await request(app)
        .patch(`/api/v1/rail/${created.body.data.id}`)
        .set("Cookie", cookie)
        .send({ companions: ["Ben"], coach: "" });
      expect(res.body.data.companions).toEqual(["Ben"]);
      expect(res.body.data.coach).toBeNull();
      const links = await prisma.railJourneyCompanion.count({
        where: { railJourneyId: created.body.data.id },
      });
      expect(links).toBe(1);
    });

    it("deletes the caller's own journey", async () => {
      const created = await create(base);
      const res = await request(app)
        .delete(`/api/v1/rail/${created.body.data.id}`)
        .set("Cookie", cookie);
      expect(res.status).toBe(204);
      expect(await prisma.railJourney.count({ where: { id: created.body.data.id } })).toBe(0);
    });
  });
});
