import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { mostExpensiveTrip } from "../tripCostSuperlative";
import { AVAILABLE_DOMAINS } from "../../../shared/domains";
/** Every domain shown — these cases are about the rule, not the gate (trips.cost.test.ts is). */
const EVERY_DOMAIN = new Set(AVAILABLE_DOMAINS);

/**
 * A recorded price of 0 is a price; null is "nobody wrote one down".
 *
 * `pushIfPriced` read `price <= 0` as "no price", the collapse flights shed on
 * 2026-09-21 (`shared/flightPricing.ts`) and cruises on 2026-09-25
 * (`cruiseSpendBase.ts`). A logbook whose only costs were a comped sailing
 * and a free rail pass abstained on "most expensive trip" instead of
 * answering 0 — and a 0 in a currency with no FX snapshot excluded the whole
 * trip as unconvertible, although 0 is 0 in every currency.
 */
describe("mostExpensiveTrip — a price of 0 is a price", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "zeroPriceTripTest" } });
    userId = (
      await prisma.user.create({
        data: { username: "zeroPriceTripTest", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("answers 0 for a trip recorded at 0, with no FX rate needed for a foreign 0", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "Prize voyage", status: "completed" },
    });
    await prisma.booking.create({ data: { userId, tripId: trip.id, price: 0, currency: "EUR" } });
    // No snapshot on purpose: 0 JPY needs no rate to be 0 EUR.
    await prisma.booking.create({ data: { userId, tripId: trip.id, price: 0, currency: "JPY" } });
    // An unknown price stays out of the sum without excluding anything.
    await prisma.booking.create({ data: { userId, tripId: trip.id, price: null } });

    expect(await mostExpensiveTrip(userId, EVERY_DOMAIN)).toEqual({
      tripId: trip.id,
      name: "Prize voyage",
      amount: 0,
      currency: "EUR",
      excluded: { count: 0, reason: "unconvertible" },
    });
  });

  it("still ranks a real cost above a trip recorded at 0", async () => {
    const paid = await prisma.trip.create({
      data: { userId, name: "Paid trip", status: "completed" },
    });
    await prisma.booking.create({ data: { userId, tripId: paid.id, price: 10, currency: "EUR" } });

    const result = await mostExpensiveTrip(userId, EVERY_DOMAIN);
    expect(result?.tripId).toBe(paid.id);
    expect(result?.amount).toBe(10);
  });
});
