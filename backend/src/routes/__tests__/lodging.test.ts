import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as fx from "../../services/fx/frankfurter";

describe("Lodging API", () => {
  let authCookie: string;
  let userId: string;
  let otherUserId: string;
  let lodgingId: string;

  beforeAll(async () => {
    await prisma.lodgingStay.deleteMany({
      where: { user: { username: { in: ["lodgingtest", "lodgingother"] } } },
    });
    await prisma.lodging.deleteMany({
      where: { user: { username: { in: ["lodgingtest", "lodgingother"] } } },
    });
    await prisma.user.deleteMany({ where: { username: { in: ["lodgingtest", "lodgingother"] } } });

    const u = await prisma.user.create({
      data: { username: "lodgingtest", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: "lodgingother", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;

    // Explicit settings row with baseCurrency=EUR (the DB default), so
    // getBaseCurrency() reads a real row rather than falling back.
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });

    const lodging = await prisma.lodging.create({
      data: { userId, name: "Grand Hotel Zürich", city: "Zürich", country: "CH" },
    });
    lodgingId = lodging.id;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.lodging.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.userSettings.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  describe("POST /api/v1/lodging/:id/stays — FX snapshot on write", () => {
    it("snapshots a CHF stay into EUR base on create", async () => {
      jest
        .spyOn(fx, "convertToBase")
        .mockResolvedValue({ baseAmount: 424.45, rate: 1.0106, rateDate: "2024-05-13" });
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-05-13T15:00:00.000Z",
          checkOut: "2024-05-15T11:00:00.000Z",
          totalPrice: 420,
          currency: "CHF",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.totalPriceBase).toBe(424.45);
      expect(res.body.data.fxRate).toBeCloseTo(1.0106, 4);
      expect(res.body.data.fxBaseCurrency).toBe("EUR");
    });

    it("sets base = original for a same-currency stay (no network call)", async () => {
      const spy = jest.spyOn(fx, "convertToBase");
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-06-01T15:00:00.000Z",
          checkOut: "2024-06-02T11:00:00.000Z",
          totalPrice: 150,
          currency: "EUR",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.totalPriceBase).toBe(150);
      expect(res.body.data.fxRate).toBe(1);
      expect(res.body.data.fxBaseCurrency).toBe("EUR");
      // convertToBase short-circuits from===base before any fetch — still
      // "called" (it's the real implementation), just never hits the network.
      expect(spy).toHaveBeenCalledWith(150, "EUR", "EUR", expect.any(Date));
    });

    it("saves the stay even when FX fails (no base value)", async () => {
      jest.spyOn(fx, "convertToBase").mockResolvedValue(null);
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-07-01T15:00:00.000Z",
          checkOut: "2024-07-02T11:00:00.000Z",
          totalPrice: 200,
          currency: "USD",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.totalPriceBase).toBeNull();
      expect(res.body.data.fxRate).toBeNull();
      expect(res.body.data.fxBaseCurrency).toBeNull();
    });

    it("clears the FX snapshot when no totalPrice is given (never calls FX)", async () => {
      const spy = jest.spyOn(fx, "convertToBase");
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({ checkIn: "2024-07-10T15:00:00.000Z", checkOut: "2024-07-11T11:00:00.000Z" });
      expect(res.status).toBe(201);
      expect(res.body.data.totalPriceBase).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    });

    it("passes the check-in calendar day (UTC) to convertToBase, unshifted", async () => {
      // A late-evening UTC check-in must snapshot the SAME calendar day, not
      // the next one — this is the reviewer-flagged UTC-consistency gotcha.
      const spy = jest
        .spyOn(fx, "convertToBase")
        .mockResolvedValue({ baseAmount: 100, rate: 1, rateDate: "2024-08-20" });
      await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-08-20T23:30:00.000Z",
          checkOut: "2024-08-21T10:00:00.000Z",
          totalPrice: 100,
          currency: "USD",
        });
      const passedDate = spy.mock.calls[0][3] as Date;
      expect(passedDate.toISOString().slice(0, 10)).toBe("2024-08-20");
    });

    it("returns 404 when the lodging does not exist", async () => {
      const res = await request(app)
        .post("/api/v1/lodging/00000000-0000-0000-0000-000000000000/stays")
        .set("Cookie", authCookie)
        .send({ checkIn: "2024-07-01T00:00:00.000Z", checkOut: "2024-07-02T00:00:00.000Z" });
      expect(res.status).toBe(404);
    });

    it("requires authentication", async () => {
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .send({ checkIn: "2024-07-01T00:00:00.000Z", checkOut: "2024-07-02T00:00:00.000Z" });
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH /api/v1/lodging/:id/stays/:stayId — selective FX re-snapshot", () => {
    let stayId: string;

    beforeAll(async () => {
      jest
        .spyOn(fx, "convertToBase")
        .mockResolvedValue({ baseAmount: 100, rate: 1, rateDate: "2024-08-01" });
      const res = await request(app)
        .post(`/api/v1/lodging/${lodgingId}/stays`)
        .set("Cookie", authCookie)
        .send({
          checkIn: "2024-08-01T15:00:00.000Z",
          checkOut: "2024-08-02T11:00:00.000Z",
          totalPrice: 100,
          currency: "EUR",
        });
      stayId = res.body.data.id;
      jest.restoreAllMocks();
    });

    it("does not touch a previously-good FX snapshot on an unrelated field edit", async () => {
      const spy = jest.spyOn(fx, "convertToBase");
      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}/stays/${stayId}`)
        .set("Cookie", authCookie)
        .send({ notes: "Lovely stay" });
      expect(res.status).toBe(200);
      expect(res.body.data.totalPriceBase).toBe(100);
      expect(res.body.data.notes).toBe("Lovely stay");
      expect(spy).not.toHaveBeenCalled();
    });

    it("re-snapshots FX when totalPrice changes", async () => {
      jest.spyOn(fx, "convertToBase").mockResolvedValue({ baseAmount: 250, rate: 1, rateDate: "2024-08-01" });
      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}/stays/${stayId}`)
        .set("Cookie", authCookie)
        .send({ totalPrice: 250 });
      expect(res.status).toBe(200);
      expect(res.body.data.totalPriceBase).toBe(250);
    });

    it("re-snapshots FX when currency changes, using the existing totalPrice", async () => {
      const spy = jest
        .spyOn(fx, "convertToBase")
        .mockResolvedValue({ baseAmount: 999, rate: 3.996, rateDate: "2024-08-01" });
      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}/stays/${stayId}`)
        .set("Cookie", authCookie)
        .send({ currency: "USD" });
      expect(res.status).toBe(200);
      expect(res.body.data.totalPriceBase).toBe(999);
      expect(spy).toHaveBeenCalledWith(250, "USD", "EUR", expect.any(Date));
    });

    it("returns 404 for a stay that does not belong to the given lodging", async () => {
      const otherLodging = await prisma.lodging.create({ data: { userId, name: "Other Own Hotel" } });
      const res = await request(app)
        .patch(`/api/v1/lodging/${otherLodging.id}/stays/${stayId}`)
        .set("Cookie", authCookie)
        .send({ notes: "x" });
      expect(res.status).toBe(404);
    });

    it("rejects an empty PATCH body — no silent no-op (finding 4)", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}/stays/${stayId}`)
        .set("Cookie", authCookie)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/v1/lodging/:id/stays/:stayId — merged effective date validation (finding 3)", () => {
    let dateLodgingId: string;
    let dateStayId: string;

    beforeAll(async () => {
      const l = await prisma.lodging.create({ data: { userId, name: "Date Order Test Hotel" } });
      dateLodgingId = l.id;
      const stay = await prisma.lodgingStay.create({
        data: {
          lodgingId: l.id,
          userId,
          checkIn: new Date("2024-10-10T15:00:00.000Z"),
          checkOut: new Date("2024-10-12T11:00:00.000Z"),
        },
      });
      dateStayId = stay.id;
    });

    it("rejects a checkIn-only PATCH landing after the existing checkOut (row unchanged)", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging/${dateLodgingId}/stays/${dateStayId}`)
        .set("Cookie", authCookie)
        .send({ checkIn: "2024-10-13T00:00:00.000Z" });
      expect(res.status).toBe(400);
      const stay = await prisma.lodgingStay.findUnique({ where: { id: dateStayId } });
      expect(stay?.checkIn.toISOString()).toBe("2024-10-10T15:00:00.000Z");
    });

    it("rejects a checkOut-only PATCH landing before the existing checkIn (row unchanged)", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging/${dateLodgingId}/stays/${dateStayId}`)
        .set("Cookie", authCookie)
        .send({ checkOut: "2024-10-09T00:00:00.000Z" });
      expect(res.status).toBe(400);
      const stay = await prisma.lodgingStay.findUnique({ where: { id: dateStayId } });
      expect(stay?.checkOut.toISOString()).toBe("2024-10-12T11:00:00.000Z");
    });

    it("accepts a legitimate single-date PATCH that keeps the order valid", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging/${dateLodgingId}/stays/${dateStayId}`)
        .set("Cookie", authCookie)
        .send({ checkOut: "2024-10-14T00:00:00.000Z" });
      expect(res.status).toBe(200);
      expect(res.body.data.checkOut).toBe("2024-10-14T00:00:00.000Z");
    });
  });

  describe("Lodging CRUD", () => {
    it("creates a lodging with a null overall rating (no stays yet)", async () => {
      const res = await request(app)
        .post("/api/v1/lodging")
        .set("Cookie", authCookie)
        .send({ name: "Boutique Inn", city: "Paris", country: "FR" });
      expect(res.status).toBe(201);
      expect(res.body.data.userId).toBe(userId);
      expect(res.body.data.overallRating).toBeNull();
    });

    it("sets dataSource='manual' server-side and ignores a client-forged value (finding 1)", async () => {
      const res = await request(app)
        .post("/api/v1/lodging")
        .set("Cookie", authCookie)
        .send({ name: "Forged Source Inn", dataSource: "parser" });
      expect(res.status).toBe(201);
      expect(res.body.data.dataSource).toBe("manual");
    });

    it("does not allow PATCH to change dataSource (finding 1)", async () => {
      const create = await request(app)
        .post("/api/v1/lodging")
        .set("Cookie", authCookie)
        .send({ name: "Immutable Source Inn" });
      expect(create.body.data.dataSource).toBe("manual");

      // dataSource is not a field on updateLodgingSchema at all, so it is
      // stripped before validation; a real field (`name`) rides along so the
      // "at least one field" guard doesn't reject the request outright.
      const res = await request(app)
        .patch(`/api/v1/lodging/${create.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ name: "Renamed Inn", dataSource: "enriched" });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Renamed Inn");
      expect(res.body.data.dataSource).toBe("manual");
    });

    it("rejects an invalid payload (missing name)", async () => {
      const res = await request(app).post("/api/v1/lodging").set("Cookie", authCookie).send({});
      expect(res.status).toBe(400);
    });

    it("derives the overall rating as the mean of rated stays, ignores unrated, handles a same-day (0-night) stay", async () => {
      const lodging = await prisma.lodging.create({ data: { userId, name: "Rated Hotel" } });
      await prisma.lodgingStay.createMany({
        data: [
          {
            lodgingId: lodging.id,
            userId,
            checkIn: new Date("2024-01-01T00:00:00.000Z"),
            checkOut: new Date("2024-01-02T00:00:00.000Z"),
            ratingOverall: 4,
          },
          {
            lodgingId: lodging.id,
            userId,
            checkIn: new Date("2024-02-01T00:00:00.000Z"),
            checkOut: new Date("2024-02-03T00:00:00.000Z"),
            ratingOverall: 5,
          },
          {
            lodgingId: lodging.id,
            userId,
            checkIn: new Date("2024-03-01T00:00:00.000Z"),
            checkOut: new Date("2024-03-01T00:00:00.000Z"),
          },
        ],
      });
      const res = await request(app)
        .get(`/api/v1/lodging/${lodging.id}`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.overallRating).toBe(4.5);
      expect(res.body.data.stayCount).toBe(3);
      expect(res.body.data.nights).toBe(3); // 1 + 2 + 0
    });

    it("updates a lodging", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}`)
        .set("Cookie", authCookie)
        .send({ stars: 4 });
      expect(res.status).toBe(200);
      expect(res.body.data.stars).toBe(4);
    });

    it("deletes a lodging and cascades its stays", async () => {
      const lodging = await prisma.lodging.create({ data: { userId, name: "To Delete" } });
      const stay = await prisma.lodgingStay.create({
        data: {
          lodgingId: lodging.id,
          userId,
          checkIn: new Date("2024-01-01T00:00:00.000Z"),
          checkOut: new Date("2024-01-02T00:00:00.000Z"),
        },
      });
      const res = await request(app).delete(`/api/v1/lodging/${lodging.id}`).set("Cookie", authCookie);
      expect(res.status).toBe(204);
      const goneStay = await prisma.lodgingStay.findUnique({ where: { id: stay.id } });
      expect(goneStay).toBeNull();
    });

    it("lists only the authenticated user's lodgings", async () => {
      const res = await request(app).get("/api/v1/lodging").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      for (const l of res.body.data) {
        expect(l.userId).toBe(userId);
      }
    });

    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/lodging");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/lodging — sort applies to the full result set, then paginates (finding 2)", () => {
    const countryTag = "SortRegressionTest";
    // Creation order (and thus DB createdAt-desc order) is deliberately
    // SCRAMBLED relative to nights, so a "sort the already-truncated page"
    // bug produces a different page-2 than a correct "sort then paginate".
    // Created in this order: 3,1,5,2,4 nights -> createdAt desc = [4,2,5,1,3].
    const nightsInCreationOrder = [3, 1, 5, 2, 4];
    let idsInCreationOrder: string[];

    beforeAll(async () => {
      idsInCreationOrder = [];
      for (const n of nightsInCreationOrder) {
        const l = await prisma.lodging.create({
          data: { userId, name: `SortHotel ${n}`, country: countryTag },
        });
        await prisma.lodgingStay.create({
          data: {
            lodgingId: l.id,
            userId,
            checkIn: new Date("2024-01-01T00:00:00.000Z"),
            checkOut: new Date(new Date("2024-01-01T00:00:00.000Z").getTime() + n * 86400000),
          },
        });
        idsInCreationOrder.push(l.id);
      }
    });

    it("returns the globally-correct page 2 sorted by nights, not a re-sort of the truncated page", async () => {
      // Correct answer: sort ALL 5 rows by nights desc (5,4,3,2,1), then
      // slice offset=2/limit=2 -> the two middle-nights rows (3 and 2).
      const idByNights = new Map(
        nightsInCreationOrder.map((n, i) => [n, idsInCreationOrder[i]]),
      );
      const expectedGlobalOrder = [5, 4, 3, 2, 1].map((n) => idByNights.get(n));
      const res = await request(app)
        .get(`/api/v1/lodging?country=${countryTag}&sort=nights&limit=2&offset=2`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.map((l: { id: string }) => l.id)).toEqual(
        expectedGlobalOrder.slice(2, 4),
      );
    });
  });

  describe("Ownership isolation (no cross-user data leak)", () => {
    it("404s reading another user's lodging", async () => {
      const foreign = await prisma.lodging.create({ data: { userId: otherUserId, name: "Foreign Hotel" } });
      const res = await request(app).get(`/api/v1/lodging/${foreign.id}`).set("Cookie", authCookie);
      expect(res.status).toBe(404);
    });

    it("404s updating another user's lodging", async () => {
      const foreign = await prisma.lodging.create({ data: { userId: otherUserId, name: "Foreign Hotel 2" } });
      const res = await request(app)
        .patch(`/api/v1/lodging/${foreign.id}`)
        .set("Cookie", authCookie)
        .send({ name: "Hacked" });
      expect(res.status).toBe(404);
    });

    it("404s deleting another user's lodging (row survives)", async () => {
      const foreign = await prisma.lodging.create({ data: { userId: otherUserId, name: "Foreign Hotel 3" } });
      const res = await request(app).delete(`/api/v1/lodging/${foreign.id}`).set("Cookie", authCookie);
      expect(res.status).toBe(404);
      const still = await prisma.lodging.findUnique({ where: { id: foreign.id } });
      expect(still).not.toBeNull();
    });

    it("404s creating a stay under another user's lodging", async () => {
      const foreign = await prisma.lodging.create({ data: { userId: otherUserId, name: "Foreign Hotel 4" } });
      const res = await request(app)
        .post(`/api/v1/lodging/${foreign.id}/stays`)
        .set("Cookie", authCookie)
        .send({ checkIn: "2024-09-01T00:00:00.000Z", checkOut: "2024-09-02T00:00:00.000Z" });
      expect(res.status).toBe(404);
    });

    it("404s patching a stay belonging to another user's lodging (row untouched)", async () => {
      const foreign = await prisma.lodging.create({ data: { userId: otherUserId, name: "Foreign Hotel 5" } });
      const foreignStay = await prisma.lodgingStay.create({
        data: {
          lodgingId: foreign.id,
          userId: otherUserId,
          checkIn: new Date("2024-09-01T00:00:00.000Z"),
          checkOut: new Date("2024-09-02T00:00:00.000Z"),
        },
      });
      const res = await request(app)
        .patch(`/api/v1/lodging/${foreign.id}/stays/${foreignStay.id}`)
        .set("Cookie", authCookie)
        .send({ notes: "x" });
      expect(res.status).toBe(404);
      const still = await prisma.lodgingStay.findUnique({ where: { id: foreignStay.id } });
      expect(still?.notes).toBeNull();
    });

    it("404s deleting a stay belonging to another user's lodging (row survives)", async () => {
      const foreign = await prisma.lodging.create({ data: { userId: otherUserId, name: "Foreign Hotel 6" } });
      const foreignStay = await prisma.lodgingStay.create({
        data: {
          lodgingId: foreign.id,
          userId: otherUserId,
          checkIn: new Date("2024-09-01T00:00:00.000Z"),
          checkOut: new Date("2024-09-02T00:00:00.000Z"),
        },
      });
      const res = await request(app)
        .delete(`/api/v1/lodging/${foreign.id}/stays/${foreignStay.id}`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(404);
      const still = await prisma.lodgingStay.findUnique({ where: { id: foreignStay.id } });
      expect(still).not.toBeNull();
    });
  });
});
