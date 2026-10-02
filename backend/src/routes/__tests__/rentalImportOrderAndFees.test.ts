import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { rentalCreationLimiter } from "../../middleware/rateLimit";
import { rentalStatsFor } from "../../services/rental/rentalStats";

/**
 * Two owner rules of 2026-10-01 on rental imports, with invented values:
 *
 * - Mails arrive out of order. Of two dated mails of one booking the NEWER
 *   one's data stands (`lastMailSentAt`); an older one only fills gaps.
 * - A cancellation fee is the cancelled rental's cost, flagged as a fee — a
 *   cost of its own in the statistics, never a rental-day cost.
 */
describe("rental imports — mail order and cancellation fees", () => {
  let cookie: string;
  let userId: string;

  const post = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/rentals/import").set("Cookie", cookie).send(body);

  const confirmation = (sentAt: string | null, over: Record<string, unknown> = {}) => ({
    kind: "confirmation",
    mailSentAt: sentAt,
    input: {
      provider: "Sixt",
      confirmationNumber: "5550001111",
      pickupStation: { name: "Frankfurt Flughafen", iata: "FRA" },
      pickupLocal: "2026-07-06T09:15",
      returnLocal: "2026-07-08T18:45",
      price: 100,
      currency: "EUR",
      ...over,
    },
  });

  const cancellation = (sentAt: string | null, fee: unknown = null) => ({
    kind: "cancellation",
    provider: "Sixt",
    confirmationNumber: "5550001111",
    fee,
    mailSentAt: sentAt,
  });

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

  describe("out-of-order mails", () => {
    it("keeps the newer mail's data when an older one is imported after it", async () => {
      await post(
        confirmation("2026-05-02T10:00:00Z", { returnLocal: "2026-07-09T12:00", price: 140 })
      );
      const res = await post(confirmation("2026-05-01T10:00:00Z"));
      expect(res.status).toBe(200);
      expect(res.body.meta.outcome).toBe("stale");
      expect(res.body.data).toMatchObject({ price: 140 });
      expect(res.body.data.times.return.local).toMatch(/^2026-07-09T12:00/);
      expect(res.body.data.lastMailSentAt).toBe("2026-05-02T10:00:00.000Z");
    });

    it("lets an older mail fill only what the newer one left empty", async () => {
      await post(confirmation("2026-05-02T10:00:00Z", { vehicleClass: null, price: 140 }));
      const res = await post(confirmation("2026-05-01T10:00:00Z", { vehicleClass: "Kompakt" }));
      expect(res.body.meta.outcome).toBe("updated");
      expect(res.body.data).toMatchObject({ vehicleClass: "Kompakt", price: 140 });
      expect(res.body.data.lastMailSentAt).toBe("2026-05-02T10:00:00.000Z");
    });

    it("applies a newer mail over an older one and moves the mark forward", async () => {
      await post(confirmation("2026-05-01T10:00:00Z"));
      const res = await post(confirmation("2026-05-02T10:00:00Z", { price: 140 }));
      expect(res.body.meta.outcome).toBe("updated");
      expect(res.body.data).toMatchObject({ price: 140 });
      expect(res.body.data.lastMailSentAt).toBe("2026-05-02T10:00:00.000Z");
    });

    it("does not cancel on a cancellation older than the newest confirmation", async () => {
      await post(confirmation("2026-05-03T10:00:00Z"));
      const res = await post(cancellation("2026-05-02T10:00:00Z"));
      expect(res.body.meta.outcome).toBe("stale");
      expect(res.body.data.status).not.toBe("cancelled");
    });

    it("applies an undated mail as before — it cannot be ordered", async () => {
      await post(confirmation("2026-05-02T10:00:00Z"));
      const res = await post(confirmation(null, { price: 140 }));
      expect(res.body.meta.outcome).toBe("updated");
      expect(res.body.data.lastMailSentAt).toBe("2026-05-02T10:00:00.000Z");
    });
  });

  describe("cancellation fees", () => {
    it("stores the fee as the cancelled rental's cost, flagged as a fee", async () => {
      await post(confirmation("2026-05-01T10:00:00Z"));
      const res = await post(
        cancellation("2026-05-04T10:00:00Z", { amount: 45.5, currency: "EUR" })
      );
      expect(res.body.meta.outcome).toBe("cancelled");
      expect(res.body.data).toMatchObject({
        status: "cancelled",
        finalAmount: 45.5,
        finalCurrency: "EUR",
        finalAmountSource: "cancellationFee",
        cost: { amount: 45.5, currency: "EUR", source: "cancellationFee" },
      });
    });

    it("gives a cancelled rental without a fee no cost — its booked price was never paid", async () => {
      await post(confirmation(null));
      const res = await post(cancellation(null));
      expect(res.body.data.cost).toBeNull();
    });

    it("counts a fee apart from the rentals, never in cost per rental day", async () => {
      await post(confirmation(null));
      await post(cancellation(null, { amount: 45.5, currency: "EUR" }));
      const stats = await rentalStatsFor(userId, null);
      expect(stats.rentals).toBe(0);
      expect(stats.costPerDay).toEqual([]);
      expect(stats.cancellationFees).toEqual([{ currency: "EUR", amount: 45.5, rentals: 1 }]);
    });
  });
});
