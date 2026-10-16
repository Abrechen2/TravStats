import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../db";
import {
  makeAccount,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "../../../routes/__tests__/sharingFixtures";
import { groupBookingTotals } from "../bookingTotals";

/**
 * The other members' booking totals (decision 2): one sum per currency, in
 * that currency's own minor units, never a guessed currency, every transport
 * type's bookings included.
 */
describe("groupBookingTotals", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let pair: Awaited<ReturnType<typeof sharedPair>>;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    pair = await sharedPair(anna, ben);
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const totalsSeenByBen = async () =>
    (await groupBookingTotals(pair.groupId, ben.id)).flatMap((m) => m.totals);

  it("names no currency for a booking that carries none", async () => {
    await prisma.booking.create({
      data: { userId: anna.id, tripId: pair.full.trip.id, price: 50, currency: null },
    });
    expect(await totalsSeenByBen()).toEqual([]);
  });

  it("rounds to the currency's own minor units — yen have none", async () => {
    await prisma.booking.create({
      data: { userId: anna.id, tripId: pair.full.trip.id, price: 1000.4, currency: "JPY" },
    });
    await prisma.booking.create({
      data: { userId: anna.id, tripId: pair.full.trip.id, price: 0.105, currency: "KWD" },
    });
    expect(await totalsSeenByBen()).toEqual([
      { currency: "JPY", amount: 1000 },
      { currency: "KWD", amount: 0.105 },
    ]);
  });

  it("counts a booking that holds only a ferry crossing of the trip", async () => {
    const ferry = await prisma.ferryJourney.create({
      data: {
        userId: anna.id,
        tripId: pair.full.trip.id,
        depStationName: "Lisboa",
        depLat: 38.7,
        depLon: -9.1,
        arrStationName: "Barreiro",
        arrLat: 38.65,
        arrLon: -9.08,
        departureTime: new Date("2025-05-05T09:00:00Z"),
      },
    });
    await prisma.booking.create({
      data: {
        userId: anna.id,
        price: 12.5,
        currency: "EUR",
        ferryJourneys: { connect: { id: ferry.id } },
      },
    });
    expect(await totalsSeenByBen()).toEqual([{ currency: "EUR", amount: 12.5 }]);
  });
});
