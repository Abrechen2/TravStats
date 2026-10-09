import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { rentalCreationLimiter } from "../../middleware/rateLimit";
import { rentalStatsFor } from "../../services/rental/rentalStats";

/**
 * forgejo#238: a rental's deposit — held, returned, partly returned, in its
 * own currency — tracked beside the rental and NEVER a cost. Every value is
 * invented.
 */
describe("Rental deposit", () => {
  let cookie: string;
  let userId: string;

  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/rentals").set("Cookie", cookie).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/rentals/${id}`).set("Cookie", cookie).send(body);

  // Completed (in the past), so it counts in the statistics.
  const base = {
    provider: "Testcar",
    pickupStation: { iata: "FRA", name: "Frankfurt Flughafen" },
    pickupLocal: "2025-07-01T10:00",
    returnLocal: "2025-07-03T10:00",
    price: 100,
    currency: "EUR",
  };
  const deposit = {
    depositAmount: 300,
    depositCurrency: "USD",
    depositPaidOn: "2025-07-01",
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rentaldeposit" } });
    const user = await prisma.user.create({
      data: { username: "rentaldeposit", passwordHash: await hashPassword("password123") },
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

  it("stores a deposit in its own currency, with its days, unconverted", async () => {
    const res = await create({ ...base, ...deposit });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      depositAmount: 300,
      depositCurrency: "USD",
      depositPaidOn: "2025-07-01",
      depositReturnedOn: null,
      depositReturnedAmount: null,
    });
    expect(res.body.data.times.depositPaid).toEqual({
      date: "2025-07-01",
      zone: null,
      precision: "day",
    });
  });

  it("records a partial refund as a returned amount below the held one", async () => {
    const id = (await create({ ...base, ...deposit })).body.data.id;
    const res = await patch(id, { depositReturnedOn: "2025-07-12", depositReturnedAmount: 250 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      depositReturnedOn: "2025-07-12",
      depositReturnedAmount: 250,
      depositAmount: 300,
    });
  });

  it("never counts the deposit as a cost — not in the rental's cost, not in the statistics", async () => {
    const res = await create({
      ...base,
      ...deposit,
      depositCurrency: "EUR",
      depositReturnedOn: "2025-07-10",
      depositReturnedAmount: 200,
    });
    expect(res.body.data.cost).toEqual({ amount: 100, currency: "EUR", source: "booked" });
    const stats = await rentalStatsFor(userId, null);
    // Two days, 100 EUR: 50 a day. A deposit (300) or its unreturned rest
    // (100) in the sum would say 200 or 100.
    expect(stats.costPerDay).toEqual([{ currency: "EUR", perDay: 50, rentals: 1, days: 2 }]);
  });

  it("leaves the deposit alone when a write does not send it (the Companion's PATCH)", async () => {
    const id = (await create({ ...base, ...deposit })).body.data.id;
    const res = await patch(id, { notes: "x" });
    expect(res.body.data).toMatchObject({ depositAmount: 300, depositPaidOn: "2025-07-01" });
  });

  it("clears a deposit with null", async () => {
    const id = (await create({ ...base, ...deposit })).body.data.id;
    const res = await patch(id, {
      depositAmount: null,
      depositCurrency: null,
      depositPaidOn: null,
    });
    expect(res.body.data).toMatchObject({
      depositAmount: null,
      depositPaidOn: null,
      times: expect.objectContaining({ depositPaid: null }),
    });
  });

  it("refuses an amount without its currency", async () => {
    const res = await create({ ...base, depositAmount: 300 });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("depositCurrency");
  });

  it("refuses more back than was held, against the stored deposit", async () => {
    const id = (await create({ ...base, ...deposit })).body.data.id;
    const res = await patch(id, { depositReturnedAmount: 301 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "RENTAL_DEPOSIT_RETURN_EXCEEDS",
      field: "depositReturnedAmount",
    });
  });

  it("refuses a return before the deposit was held", async () => {
    const res = await create({ ...base, ...deposit, depositReturnedOn: "2025-06-30" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "RENTAL_DEPOSIT_RETURNED_BEFORE_PAID",
      field: "depositReturnedOn",
    });
  });

  it("refuses a day that does not exist", async () => {
    const res = await create({ ...base, ...deposit, depositPaidOn: "2025-02-30" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("depositPaidOn");
  });
});
