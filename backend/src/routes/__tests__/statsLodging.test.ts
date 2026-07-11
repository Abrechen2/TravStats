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
    expect(res.body.data.countries).toEqual(["Switzerland"]);
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
    expect(res.body.data.countries).toEqual(["Switzerland"]);

    const otherRes = await request(app)
      .get("/api/v1/stats/lodging")
      .set("Cookie", otherAuthCookie);
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.data.totalNights).toBe(9);
    expect(otherRes.body.data.countries).toEqual(["France"]);
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
});
