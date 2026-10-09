import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { mostExpensiveTrip } from "../tripCostSuperlative";
import { loadTravelAccountData } from "../../stats/travelAccountData";
import { buildTripAccount } from "../../stats/tripAccount";
import { AVAILABLE_DOMAINS } from "../../../shared/domains";
/** Every domain shown — these cases are about the rule, not the gate (trips.cost.test.ts is). */
const EVERY_DOMAIN = new Set(AVAILABLE_DOMAINS);

/**
 * forgejo#274: the "most expensive trip" and the travel account are two views
 * of ONE server rule, so for the same euro logbook they must name the same
 * amount and rank the same way. The three counter-examples of the issue failed
 * here before the rule moved to `shared/tripCost.ts`: the superlative read the
 * bare price (100 instead of 130), dropped a flight whose booking had no price
 * (null instead of 130), and so ranked a 120 trip above a 130 one.
 */
describe("most expensive trip and travel account — one cost rule", () => {
  let userId: string;

  const flight = (data: Record<string, unknown>) =>
    prisma.flight.create({
      data: {
        userId,
        status: "flown",
        depIata: "FRA",
        arrIata: "LIS",
        depLat: 50,
        depLon: 8,
        arrLat: 38,
        arrLon: -9,
        currency: "EUR",
        ...data,
      },
    });

  const accountSpend = async (tripId: string) => {
    const account = buildTripAccount((await loadTravelAccountData(userId, EVERY_DOMAIN)).trips);
    return account.trips.find((row) => row.id === tripId)!;
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripCostAgreementTest" } });
    userId = (
      await prisma.user.create({
        data: {
          username: "tripCostAgreementTest",
          passwordHash: await hashPassword("password123"),
        },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.booking.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("counter-example 1: a 100 + 20 + 10 flight is 130 on both", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "Lisboa", status: "completed" },
    });
    await flight({ tripId: trip.id, price: 100, taxes: 20, fees: 10 });

    expect((await accountSpend(trip.id)).spendByCurrency).toEqual({ EUR: 130 });
    expect(await mostExpensiveTrip(userId, EVERY_DOMAIN)).toMatchObject({
      tripId: trip.id,
      amount: 130,
      currency: "EUR",
    });
  });

  it("counter-example 2: on a booking without a price, the flight's own 130 counts on both", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Porto", status: "completed" } });
    const booking = await prisma.booking.create({
      data: { userId, tripId: trip.id, price: null },
    });
    await flight({ tripId: trip.id, bookingId: booking.id, price: 100, taxes: 20, fees: 10 });

    expect((await accountSpend(trip.id)).spendByCurrency).toEqual({ EUR: 130 });
    expect(await mostExpensiveTrip(userId, EVERY_DOMAIN)).toMatchObject({
      tripId: trip.id,
      amount: 130,
    });
  });

  it("counter-example 3: A at 130 with fees beats B at 120", async () => {
    const a = await prisma.trip.create({ data: { userId, name: "A", status: "completed" } });
    await flight({ tripId: a.id, price: 100, taxes: 20, fees: 10 });
    const b = await prisma.trip.create({ data: { userId, name: "B", status: "completed" } });
    await flight({ tripId: b.id, price: 120 });

    expect(await mostExpensiveTrip(userId, EVERY_DOMAIN)).toMatchObject({
      tripId: a.id,
      amount: 130,
    });
  });

  it("counts a booking shared by two segments once, and a free booking as free, on both", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "Two legs", status: "completed" },
    });
    const shared = await prisma.booking.create({
      data: { userId, tripId: trip.id, price: 300, currency: "EUR" },
    });
    await flight({ tripId: trip.id, bookingId: shared.id });
    await flight({ tripId: trip.id, bookingId: shared.id, price: 50 });
    // An award booking: its segment's own 200 must NOT come back.
    const award = await prisma.booking.create({
      data: { userId, tripId: trip.id, price: 0, currency: "EUR" },
    });
    await flight({ tripId: trip.id, bookingId: award.id, price: 200 });

    const row = await accountSpend(trip.id);
    expect(row.spendByCurrency).toEqual({ EUR: 300 });
    expect(row.unpricedEntries).toBe(0);
    expect(await mostExpensiveTrip(userId, EVERY_DOMAIN)).toMatchObject({
      tripId: trip.id,
      amount: 300,
    });
  });

  it("does not bill a booking to the trip it is attached to when its segments sit on another", async () => {
    const home = await prisma.trip.create({ data: { userId, name: "Home", status: "completed" } });
    const away = await prisma.trip.create({ data: { userId, name: "Away", status: "completed" } });
    const booking = await prisma.booking.create({
      data: { userId, tripId: home.id, price: 500, currency: "EUR" },
    });
    await flight({ tripId: away.id, bookingId: booking.id });

    expect((await accountSpend(home.id)).spendByCurrency).toEqual({});
    expect((await accountSpend(away.id)).spendByCurrency).toEqual({ EUR: 500 });
    expect(await mostExpensiveTrip(userId, EVERY_DOMAIN)).toMatchObject({
      tripId: away.id,
      amount: 500,
    });
  });

  it("names an unpriced flight instead of reading it as free", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "Unknown", status: "completed" },
    });
    await flight({ tripId: trip.id });

    const row = await accountSpend(trip.id);
    expect(row.spendByCurrency).toEqual({});
    expect(row.unpricedEntries).toBe(1);
    expect(await mostExpensiveTrip(userId, EVERY_DOMAIN)).toBeNull();
  });
});
