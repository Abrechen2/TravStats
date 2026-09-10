import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * What a stay costs, and what happens when its dates are taken away.
 *
 * Three defects that all came from the same place — code deciding for itself
 * what two dates mean instead of asking the module whose job that is:
 *
 *  - Clearing both dates stored nulls in the columns while every derived field
 *    still computed against the OLD dates: the check-in/out times stayed on a
 *    stay that no longer had a day to hang them on, the status came out
 *    `in_progress` for a stay with no dates at all, and the FX snapshot kept
 *    its old rate day. `input.checkIn ? ... : stay.checkIn` read an explicit
 *    `null` as "not sent" (AUD-039).
 *  - The price derivation subtracted the dates itself, so an undated stay with
 *    three stated nights got no total, and a MONTH-precision stay whose
 *    placeholder dates sit a month apart got 31 nights (AUD-040).
 *  - A total of 0 was treated as no total and replaced by per-night x nights,
 *    so a free award stay came back at full price (AUD-041).
 */
const USERNAME = `stay-dates-price-${Date.now()}`;

describe("stay dates and price", () => {
  let cookie: string;
  let userId: string;
  let lodgingId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    lodgingId = (
      await prisma.lodging.create({ data: { userId, name: "Price Hotel", type: "hotel" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  const createStay = async (body: Record<string, unknown>) => {
    const res = await request(app)
      .post(`/api/v1/lodging/${lodgingId}/stays`)
      .set("Cookie", cookie)
      .send(body);
    expect(res.status).toBe(201);
    return (res.body.data ?? res.body) as { id: string };
  };

  describe("when both dates are cleared", () => {
    it("clears the times, re-derives the status and moves the FX day with them", async () => {
      const created = await createStay({
        checkIn: "2020-01-01T00:00:00.000Z",
        checkOut: "2030-01-01T00:00:00.000Z",
        checkInTime: "15:00",
        checkOutTime: "11:00",
        totalPrice: 100,
        currency: "EUR",
      });

      const res = await request(app)
        .patch(`/api/v1/lodging/${lodgingId}/stays/${created.id}`)
        .set("Cookie", cookie)
        .send({ checkIn: null, checkOut: null, status: "completed" });
      expect(res.status).toBe(200);

      const stored = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.checkIn).toBeNull();
      expect(stored.checkOut).toBeNull();
      // A time is a claim about a day. With no day it cannot stand.
      expect(stored.checkInTime).toBeNull();
      expect(stored.checkOutTime).toBeNull();
      // With nothing to derive from, the status the client sent is the answer —
      // it used to come back `in_progress`, derived from the dates just removed.
      expect(stored.status).toBe("completed");
      // The old rate day must not survive the date it was taken from.
      expect(stored.fxRateDate).toBeNull();
    });
  });

  describe("the total price", () => {
    it("counts stated nights when there are no dates at all", async () => {
      const created = await createStay({
        datePrecision: "NONE",
        nights: 3,
        pricePerNight: 50,
        currency: "EUR",
      });
      const stored = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.totalPrice).toBe(150);
    });

    it("does not read month placeholders as a 31-night stay", async () => {
      const created = await createStay({
        datePrecision: "MONTH",
        checkIn: "2020-07-01T00:00:00.000Z",
        checkOut: "2020-08-01T00:00:00.000Z",
        nights: 3,
        pricePerNight: 50,
        currency: "EUR",
      });
      const stored = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.totalPrice).toBe(150);
    });

    it("keeps an explicit zero instead of billing the per-night rate", async () => {
      const created = await createStay({
        checkIn: "2026-05-01T00:00:00.000Z",
        checkOut: "2026-05-04T00:00:00.000Z",
        totalPrice: 0,
        pricePerNight: 50,
        currency: "EUR",
        isAwardStay: true,
      });
      const stored = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.totalPrice).toBe(0);
    });

    it("still multiplies real dates by the per-night rate", async () => {
      // The positive case — without it the three above could pass on a
      // derivation that simply never produces a number.
      const created = await createStay({
        checkIn: "2026-05-01T00:00:00.000Z",
        checkOut: "2026-05-04T00:00:00.000Z",
        pricePerNight: 50,
        currency: "EUR",
      });
      const stored = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.totalPrice).toBe(150);
    });
  });
});
