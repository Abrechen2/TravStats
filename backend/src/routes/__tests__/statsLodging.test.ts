import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("GET /api/v1/stats/lodging", () => {
  let authCookie: string;
  let userId: string;
  let otherAuthCookie: string;
  let otherUserId: string;
  let emptyAuthCookie: string;
  let emptyUserId: string;

  beforeAll(async () => {
    await prisma.lodgingStay.deleteMany({
      where: {
        user: {
          username: { in: ["statslodging", "statslodgingother", "statslodgingempty"] },
        },
      },
    });
    await prisma.lodging.deleteMany({
      where: {
        user: {
          username: { in: ["statslodging", "statslodgingother", "statslodgingempty"] },
        },
      },
    });
    await prisma.user.deleteMany({
      where: { username: { in: ["statslodging", "statslodgingother", "statslodgingempty"] } },
    });

    const u = await prisma.user.create({
      data: { username: "statslodging", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const lodging = await prisma.lodging.create({
      data: {
        userId,
        name: "Grand Hotel Zürich",
        type: "hotel",
        city: "Zürich",
        country: "Switzerland",
      },
    });

    await prisma.lodgingStay.create({
      data: {
        lodgingId: lodging.id,
        userId,
        checkIn: new Date("2024-05-13T15:00:00.000Z"),
        checkOut: new Date("2024-05-16T11:00:00.000Z"), // 3 nights
        status: "completed",
        totalPrice: 420,
        currency: "CHF",
        totalPriceBase: 424.45,
        // A real stay always carries the base currency it was snapshotted
        // into (routes/lodging.ts applyFxSnapshot) — this test seeds the DB
        // row directly, so it must set it explicitly to match reality.
        fxBaseCurrency: "EUR",
      },
    });

    const other = await prisma.user.create({
      data: { username: "statslodgingother", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
    otherAuthCookie = `auth_token=${generateToken(other.id)}`;

    const otherLodging = await prisma.lodging.create({
      data: {
        userId: otherUserId,
        name: "Some Other Hotel",
        type: "hotel",
        city: "Paris",
        country: "France",
      },
    });
    await prisma.lodgingStay.create({
      data: {
        lodgingId: otherLodging.id,
        userId: otherUserId,
        checkIn: new Date("2024-01-01T15:00:00.000Z"),
        checkOut: new Date("2024-01-10T11:00:00.000Z"), // 9 nights
        status: "completed",
        totalPrice: 900,
        currency: "EUR",
        totalPriceBase: 900,
        fxBaseCurrency: "EUR",
      },
    });

    const empty = await prisma.user.create({
      data: { username: "statslodgingempty", passwordHash: await hashPassword("password123") },
    });
    emptyUserId = empty.id;
    emptyAuthCookie = `auth_token=${generateToken(empty.id)}`;
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({
      where: { userId: { in: [userId, otherUserId, emptyUserId] } },
    });
    await prisma.lodging.deleteMany({
      where: { userId: { in: [userId, otherUserId, emptyUserId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId, emptyUserId] } } });
    await prisma.$disconnect();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/stats/lodging");
    expect(res.status).toBe(401);
  });

  it("returns real totalNights and spendBaseTotal for a user with a lodging + stay", async () => {
    const res = await request(app)
      .get("/api/v1/stats/lodging")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalNights).toBe(3);
    expect(res.body.data.spendBaseTotal).toBeCloseTo(424.45, 2);
    expect(res.body.data.lodgingsCount).toBe(1);
    expect(res.body.data.staysCount).toBe(1);
  });

  it("serializes countries as a real array, not an empty object", async () => {
    const res = await request(app)
      .get("/api/v1/stats/lodging")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.countries)).toBe(true);
    // ISO codes, not the free text a booking mail happened to use: grouping
    // joins on the code, so "Schweiz" and "Switzerland" are one country.
    expect(res.body.data.countries).toEqual(["CH"]);
    // A plain Set silently serializes to `{}` — guard against regressing to that.
    expect(res.body.data.countries).not.toEqual({});
  });

  it("does not leak another user's stays into the totals", async () => {
    const res = await request(app)
      .get("/api/v1/stats/lodging")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    // Only the 3-night CHF stay belongs to this user — the other user's
    // 9-night EUR stay must not be summed in.
    expect(res.body.data.totalNights).toBe(3);
    expect(res.body.data.spendBaseTotal).toBeCloseTo(424.45, 2);
    // ISO codes, not the free text a booking mail happened to use: grouping
    // joins on the code, so "Schweiz" and "Switzerland" are one country.
    expect(res.body.data.countries).toEqual(["CH"]);

    const otherRes = await request(app)
      .get("/api/v1/stats/lodging")
      .set("Cookie", otherAuthCookie);
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.data.totalNights).toBe(9);
    expect(otherRes.body.data.countries).toEqual(["FR"]);
  });

  it("returns sane zeros/empty values for a user with no lodgings", async () => {
    const res = await request(app)
      .get("/api/v1/stats/lodging")
      .set("Cookie", emptyAuthCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.lodgingsCount).toBe(0);
    expect(data.staysCount).toBe(0);
    expect(data.totalNights).toBe(0);
    expect(data.spendBaseTotal).toBe(0);
    expect(data.countries).toEqual([]);
    expect(data.avgRatingOverall).toBeNull();
    expect(data.chainLoyaltyMax).toBe(0);
    expect(data.sameHotelRepeatMax).toBe(0);

    // Nothing should be undefined or NaN.
    for (const value of Object.values(data)) {
      expect(value).not.toBeUndefined();
      if (typeof value === "number") {
        expect(Number.isNaN(value)).toBe(false);
      }
    }
  });

  describe("a hotel with zero stays is counted (owner decision, finding 1)", () => {
    let noStayUserId: string;
    let noStayAuthCookie: string;

    beforeAll(async () => {
      await prisma.lodgingStay.deleteMany({ where: { user: { username: "statslodgingnostay" } } });
      await prisma.lodging.deleteMany({ where: { user: { username: "statslodgingnostay" } } });
      await prisma.user.deleteMany({ where: { username: "statslodgingnostay" } });

      const u = await prisma.user.create({
        data: { username: "statslodgingnostay", passwordHash: await hashPassword("password123") },
      });
      noStayUserId = u.id;
      noStayAuthCookie = `auth_token=${generateToken(u.id)}`;

      // "NH Hotels" is a seeded real chain — reuse it instead of colliding
      // with the unique `name` constraint.
      const chain = await prisma.lodgingChain.upsert({
        where: { name: "NH Hotels" },
        update: {},
        create: { name: "NH Hotels" },
      });

      // Hotel #1 has a real completed stay.
      const hotelWithStay = await prisma.lodging.create({
        data: { userId: noStayUserId, name: "Stayed-In Hotel", country: "Germany" },
      });
      await prisma.lodgingStay.create({
        data: {
          lodgingId: hotelWithStay.id,
          userId: noStayUserId,
          checkIn: new Date("2024-05-01T00:00:00.000Z"),
          checkOut: new Date("2024-05-03T00:00:00.000Z"),
          status: "completed",
        },
      });

      // Hotel #2 was just added — assigned to a chain, but never checked into.
      await prisma.lodging.create({
        data: {
          userId: noStayUserId,
          name: "Freshly Added Hotel",
          country: "Austria",
          chainId: chain.id,
        },
      });
    });

    afterAll(async () => {
      await prisma.lodgingStay.deleteMany({ where: { userId: noStayUserId } });
      await prisma.lodging.deleteMany({ where: { userId: noStayUserId } });
      await prisma.user.deleteMany({ where: { id: noStayUserId } });
    });

    it("counts both hotels and both their countries even though one has no stay", async () => {
      // Finding 1 (2026-08-15) and the country-counting design §1.4
      // (2026-09-02): a saved house without a stay counts, as a house and as
      // its country. forgejo#80 asked for the opposite; the decision stands.
      const res = await request(app)
        .get("/api/v1/stats/lodging")
        .set("Cookie", noStayAuthCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.lodgingsCount).toBe(2);
      expect(res.body.data.chainsUnique).toBe(1);
      expect(res.body.data.staysCount).toBe(1);
      expect(res.body.data.countries.sort()).toEqual(["AT", "DE"]);
      expect(res.body.data.countriesByYear).toEqual(expect.any(Object));
    });
  });

  describe("spendBaseTotal never mixes currencies after a base-currency switch (finding 2)", () => {
    let mixedUserId: string;
    let mixedAuthCookie: string;

    beforeAll(async () => {
      await prisma.lodgingStay.deleteMany({
        where: { user: { username: "statslodgingmixed" } },
      });
      await prisma.lodging.deleteMany({ where: { user: { username: "statslodgingmixed" } } });
      await prisma.user.deleteMany({ where: { username: "statslodgingmixed" } });

      const u = await prisma.user.create({
        data: { username: "statslodgingmixed", passwordHash: await hashPassword("password123") },
      });
      mixedUserId = u.id;
      mixedAuthCookie = `auth_token=${generateToken(u.id)}`;
      // This user's CURRENT base currency is CHF.
      await prisma.userSettings.create({
        data: { userId: mixedUserId, data: {}, baseCurrency: "CHF" },
      });

      const lodging = await prisma.lodging.create({
        data: { userId: mixedUserId, name: "Mixed Currency Hotel" },
      });
      await prisma.lodgingStay.createMany({
        data: [
          {
            lodgingId: lodging.id,
            userId: mixedUserId,
            checkIn: new Date("2023-01-01T00:00:00.000Z"),
            checkOut: new Date("2023-01-02T00:00:00.000Z"),
            // Snapshotted back when the user's base currency was still EUR.
            totalPrice: 100,
            currency: "EUR",
            totalPriceBase: 100,
            fxBaseCurrency: "EUR",
          },
          {
            lodgingId: lodging.id,
            userId: mixedUserId,
            checkIn: new Date("2024-06-01T00:00:00.000Z"),
            checkOut: new Date("2024-06-02T00:00:00.000Z"),
            // Snapshotted after the switch to CHF.
            totalPrice: 300,
            currency: "CHF",
            totalPriceBase: 300,
            fxBaseCurrency: "CHF",
          },
        ],
      });
    });

    afterAll(async () => {
      await prisma.lodgingStay.deleteMany({ where: { userId: mixedUserId } });
      await prisma.lodging.deleteMany({ where: { userId: mixedUserId } });
      await prisma.userSettings.deleteMany({ where: { userId: mixedUserId } });
      await prisma.user.deleteMany({ where: { id: mixedUserId } });
    });

    it("sums spendBaseTotal only for the CURRENT base currency and exposes the rest via spendBaseByCurrency", async () => {
      const res = await request(app)
        .get("/api/v1/stats/lodging")
        .set("Cookie", mixedAuthCookie);

      expect(res.status).toBe(200);
      // Only the CHF-snapshotted stay counts toward the current-base total —
      // adding the stale EUR snapshot in would give the wrong "400 CHF".
      expect(res.body.data.spendBaseTotal).toBe(300);
      expect(res.body.data.spendBaseByCurrency).toEqual({ EUR: 100, CHF: 300 });
    });
  });
});
