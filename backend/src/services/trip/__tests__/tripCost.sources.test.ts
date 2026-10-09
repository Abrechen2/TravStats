import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { mostExpensiveTrip } from "../tripCostSuperlative";
import { loadTravelAccountData } from "../../stats/travelAccountData";
import { buildTripAccount } from "../../stats/tripAccount";
import { AVAILABLE_DOMAINS } from "../../../shared/domains";
/** Every domain shown — these cases are about the rule, not the gate (trips.cost.test.ts is). */
const EVERY_DOMAIN = new Set(AVAILABLE_DOMAINS);

/**
 * forgejo#275: train rides and rentals are cost sources of a trip. The travel
 * account loaded neither — a trip with nothing but a priced train or a rental
 * car reported no spend at all — and the "most expensive trip" could not rank
 * them either. Both surfaces read the same loader, so each case below asserts
 * the account's figure and, where it decides the ranking, the superlative's.
 */
describe("trip cost — train rides, rentals, roadtrips and expenses", () => {
  let userId: string;

  const ride = (data: Record<string, unknown>) =>
    prisma.railJourney.create({
      data: {
        userId,
        depStationName: "Wien Hbf",
        depLat: 48.18,
        depLon: 16.37,
        arrStationName: "Hamburg Hbf",
        arrLat: 53.55,
        arrLon: 10.0,
        departureTime: new Date("2025-05-05T20:00:00Z"),
        arrivalTime: new Date("2025-05-06T09:00:00Z"),
        status: "completed",
        currency: "EUR",
        ...data,
      },
    });

  const rental = (data: Record<string, unknown>) =>
    prisma.rentalBooking.create({
      data: {
        userId,
        provider: "Testcar",
        pickupStationName: "Bergen Airport",
        pickupLat: 60.29,
        pickupLon: 5.22,
        pickupTimezone: "Europe/Oslo",
        returnStationName: "Bergen Airport",
        returnLat: 60.29,
        returnLon: 5.22,
        returnTimezone: "Europe/Oslo",
        pickupTime: new Date("2025-06-01T08:00:00Z"),
        returnTime: new Date("2025-06-08T08:00:00Z"),
        status: "completed",
        ...data,
      },
    });

  const tripNamed = (name: string) =>
    prisma.trip.create({ data: { userId, name, status: "completed" } });

  const row = async (tripId: string) => {
    const account = buildTripAccount((await loadTravelAccountData(userId, EVERY_DOMAIN)).trips);
    return account.trips.find((r) => r.id === tripId)!;
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripCostSourcesTest" } });
    userId = (
      await prisma.user.create({
        data: { username: "tripCostSourcesTest", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.rentalBooking.deleteMany({ where: { userId } });
    await prisma.tripExpense.deleteMany({ where: { userId } });
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.booking.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("a pure rail trip costs its ride, on the account and in the ranking", async () => {
    const trip = await tripNamed("Nightjet");
    await ride({ tripId: trip.id, price: 189 });

    expect((await row(trip.id)).spendByCurrency).toEqual({ EUR: 189 });
    expect(await mostExpensiveTrip(userId, EVERY_DOMAIN)).toMatchObject({
      tripId: trip.id,
      amount: 189,
    });
  });

  it("a connection of three trains on one booking costs the booking once", async () => {
    const trip = await tripNamed("Connection");
    const booking = await prisma.booking.create({
      data: { userId, tripId: trip.id, price: 149, currency: "EUR" },
    });
    for (let i = 0; i < 3; i += 1) await ride({ tripId: trip.id, bookingId: booking.id });

    const account = await row(trip.id);
    expect(account.spendByCurrency).toEqual({ EUR: 149 });
    expect(account.unpricedEntries).toBe(0);
  });

  it("a pure rental trip costs the invoice when there is one, else the booked price", async () => {
    const invoiced = await tripNamed("Invoiced");
    await rental({
      tripId: invoiced.id,
      price: 300,
      currency: "EUR",
      finalAmount: 342.5,
      finalCurrency: "EUR",
    });
    const booked = await tripNamed("Booked");
    await rental({ tripId: booked.id, price: 300, currency: "EUR" });

    expect((await row(invoiced.id)).spendByCurrency).toEqual({ EUR: 342.5 });
    expect((await row(booked.id)).spendByCurrency).toEqual({ EUR: 300 });
    expect(await mostExpensiveTrip(userId, EVERY_DOMAIN)).toMatchObject({
      tripId: invoiced.id,
      amount: 342.5,
    });
  });

  it("a rental on the trip's roadtrip is billed once, and its fuel and tolls stay their own", async () => {
    const trip = await tripNamed("Fjords by car");
    const roadtrip = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Westküste", mode: "road", kind: "roadtrip" },
    });
    // Filed under the trip AND driven on its roadtrip: one car, one price.
    await rental({ tripId: trip.id, routeId: roadtrip.id, price: 500, currency: "EUR" });
    // Driven on the roadtrip, filed under no trip: still this trip's car.
    await rental({ routeId: roadtrip.id, price: 2000, currency: "NOK" });
    await prisma.tripExpense.createMany({
      data: [
        { userId, routeId: roadtrip.id, kind: "fuel", amount: 80, currency: "EUR" },
        { userId, routeId: roadtrip.id, kind: "toll", amount: 450, currency: "NOK" },
      ],
    });

    expect((await row(trip.id)).spendByCurrency).toEqual({ EUR: 580, NOK: 2450 });
  });

  it("a mixed trip adds every source once", async () => {
    const trip = await tripNamed("Mixed");
    await ride({ tripId: trip.id, price: 59 });
    await rental({ tripId: trip.id, price: 210, currency: "EUR" });
    await prisma.tripExpense.create({
      data: { userId, tripId: trip.id, kind: "ferry", amount: 31, currency: "EUR" },
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId: trip.id,
        status: "flown",
        depIata: "HAM",
        arrIata: "BGO",
        depLat: 53.6,
        depLon: 10,
        arrLat: 60.3,
        arrLon: 5.2,
        price: 100,
        taxes: 20,
        currency: "EUR",
      },
    });

    expect((await row(trip.id)).spendByCurrency).toEqual({ EUR: 420 });
    expect(await mostExpensiveTrip(userId, EVERY_DOMAIN)).toMatchObject({
      tripId: trip.id,
      amount: 420,
    });
    await prisma.flight.deleteMany({ where: { userId } });
  });

  it("leaves cancelled entries out, keeps a cancellation fee, and names missing prices", async () => {
    const trip = await tripNamed("Patchy");
    await ride({ tripId: trip.id, price: 99, status: "cancelled" });
    await rental({ tripId: trip.id, price: 400, currency: "EUR", status: "cancelled" });
    await rental({
      tripId: trip.id,
      price: 400,
      currency: "EUR",
      status: "cancelled",
      finalAmount: 40,
      finalCurrency: "EUR",
      finalAmountSource: "cancellationFee",
    });
    await ride({ tripId: trip.id });
    await rental({ tripId: trip.id });

    const account = await row(trip.id);
    expect(account.spendByCurrency).toEqual({ EUR: 40 });
    expect(account.unpricedEntries).toBe(2);
  });

  it("ranks a trip whose expenses make it the dearest, and leaves out one it cannot convert", async () => {
    const plain = await tripNamed("Plain");
    await ride({ tripId: plain.id, price: 100 });
    const withFerry = await tripNamed("With ferry");
    await ride({ tripId: withFerry.id, price: 60 });
    await prisma.tripExpense.create({
      data: { userId, tripId: withFerry.id, kind: "ferry", amount: 70, currency: "EUR" },
    });
    // No snapshot exists for an expense: a foreign one cannot be ranked.
    const foreign = await tripNamed("Foreign toll");
    await prisma.tripExpense.create({
      data: { userId, tripId: foreign.id, kind: "toll", amount: 9000, currency: "NOK" },
    });

    expect(await mostExpensiveTrip(userId, EVERY_DOMAIN)).toEqual({
      tripId: withFerry.id,
      name: "With ferry",
      amount: 130,
      currency: "EUR",
      excluded: { count: 1, reason: "unconvertible" },
    });
  });
});
