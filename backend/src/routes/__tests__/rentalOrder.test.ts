import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { rentalCreationLimiter } from "../../middleware/rateLimit";

/**
 * The one order rule of a rental's ends (review I1–I3): a minute end is a
 * point, a day-only end its whole local day at its own station. A return is
 * refused only when it CERTAINLY lies before the pickup — for booked and
 * actual ends alike — and the actual pair is checked only when a write moves
 * it. Every value is invented. FRA is Berlin (UTC+2 in July), NRT Tokyo (+9).
 */
describe("Rental order of ends", () => {
  let cookie: string;
  let userId: string;

  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/rentals").set("Cookie", cookie).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/rentals/${id}`).set("Cookie", cookie).send(body);

  const FRA = { iata: "FRA", name: "Frankfurt Flughafen" };
  const NRT = { iata: "NRT", name: "Tokyo Narita" };
  const base = { provider: "Testcar", pickupStation: FRA };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rentalorder" } });
    const user = await prisma.user.create({
      data: { username: "rentalorder", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterEach(async () => {
    await prisma.rentalBooking.deleteMany({ where: { userId } });
    await rentalCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("booked ends", () => {
    it("accepts a day-only return on the day of a timed pickup", async () => {
      const res = await create({
        ...base,
        pickupLocal: "2026-07-01T10:00",
        returnLocal: "2026-07-01",
      });
      expect(res.status).toBe(201);
      expect(res.body.data.times.return.precision).toBe("day");
    });

    it("refuses a day-only return on the day before a timed pickup", async () => {
      const res = await create({
        ...base,
        pickupLocal: "2026-07-02T10:00",
        returnLocal: "2026-07-01",
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "RENTAL_RETURN_BEFORE_PICKUP", field: "returnLocal" });
    });

    it("accepts two day-only ends on one day, refuses a return day before the pickup day", async () => {
      expect(
        (await create({ ...base, pickupLocal: "2026-07-01", returnLocal: "2026-07-01" })).status
      ).toBe(201);
      const backwards = await create({
        ...base,
        confirmationNumber: "B",
        pickupLocal: "2026-07-02",
        returnLocal: "2026-07-01",
      });
      expect(backwards.status).toBe(400);
      expect(backwards.body.code).toBe("RENTAL_RETURN_BEFORE_PICKUP");
    });

    it("refuses a day-only return the day before a pickup at midnight", async () => {
      const res = await create({
        ...base,
        pickupLocal: "2026-07-02T00:00",
        returnLocal: "2026-07-01",
      });
      expect(res.status).toBe(400);
    });

    it("judges a day across zones by instants, not by its label", async () => {
      // Tokyo's 1 July ends at 15:00Z. A Berlin pickup at 10:00 (08:00Z) is
      // inside it — valid; one at 20:00 (18:00Z) is after it — refused,
      // though both name the same calendar day.
      const inside = await create({
        ...base,
        returnStation: NRT,
        pickupLocal: "2026-07-01T10:00",
        returnLocal: "2026-07-01",
      });
      expect(inside.status).toBe(201);
      const after = await create({
        ...base,
        confirmationNumber: "Z",
        returnStation: NRT,
        pickupLocal: "2026-07-01T20:00",
        returnLocal: "2026-07-01",
      });
      expect(after.status).toBe(400);
      expect(after.body.code).toBe("RENTAL_RETURN_BEFORE_PICKUP");
    });
  });

  it("keeps the database backstop: a minute return before the pickup cannot be stored", async () => {
    const id = (
      await create({ ...base, pickupLocal: "2026-07-01T10:00", returnLocal: "2026-07-01" })
    ).body.data.id;
    await expect(
      prisma.rentalBooking.update({
        where: { id },
        data: { returnPrecision: "minute", returnTime: new Date("2026-06-30T22:00:00Z") },
      })
    ).rejects.toThrow();
  });

  describe("actual ends", () => {
    const booked = { ...base, pickupLocal: "2026-07-01T10:00", returnLocal: "2026-07-05T10:00" };

    it("refuses two day-only actual ends with the return a day earlier", async () => {
      const res = await create({
        ...booked,
        actualPickupLocal: "2026-07-02",
        actualReturnLocal: "2026-07-01",
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RENTAL_ACTUAL_RETURN_BEFORE_PICKUP");
    });

    it("refuses a day-only actual return the day before an actual pickup at midnight", async () => {
      const res = await create({
        ...booked,
        actualPickupLocal: "2026-07-02T00:00",
        actualReturnLocal: "2026-07-01",
      });
      expect(res.status).toBe(400);
    });

    it("still accepts a day-only actual return on the actual pickup's day", async () => {
      const res = await create({
        ...booked,
        actualPickupLocal: "2026-07-01T10:05",
        actualReturnLocal: "2026-07-01",
      });
      expect(res.status).toBe(201);
    });
  });

  describe("a legacy reversed pair (an invoice day stored as a midnight minute)", () => {
    async function legacyRow(): Promise<string> {
      const id = (
        await create({ ...base, pickupLocal: "2026-07-01T10:00", returnLocal: "2026-07-01T18:00" })
      ).body.data.id;
      // As the pre-branch write stored it and the precision migration marked
      // it: actual pickup 10:05, actual return the day's midnight, both minutes.
      await prisma.rentalBooking.update({
        where: { id },
        data: {
          actualPickupTime: new Date("2026-07-01T08:05:00Z"),
          actualPickupPrecision: "minute",
          actualReturnTime: new Date("2026-06-30T22:00:00Z"),
          actualReturnPrecision: "minute",
        },
      });
      return id;
    }

    it("never blocks a write that does not move the actual ends (notes, deposit)", async () => {
      const id = await legacyRow();
      const notes = await patch(id, { notes: "Schlüssel abgegeben" });
      expect(notes.status).toBe(200);
      expect(notes.body.data.actualReturnTime).toBe("2026-06-30T22:00:00.000Z");
      const deposit = await patch(id, { depositAmount: 300, depositCurrency: "EUR" });
      expect(deposit.status).toBe(200);
    });

    it("refuses a write that sends an actual end still before the pickup", async () => {
      const id = await legacyRow();
      const res = await patch(id, { actualReturnLocal: "2026-07-01T09:00" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RENTAL_ACTUAL_RETURN_BEFORE_PICKUP");
    });

    it("lets the user repair it by marking the return as the day it was", async () => {
      const id = await legacyRow();
      const res = await patch(id, { actualReturnLocal: "2026-07-01" });
      expect(res.status).toBe(200);
      expect(res.body.data.times.actualReturn.precision).toBe("day");
    });
  });
});
