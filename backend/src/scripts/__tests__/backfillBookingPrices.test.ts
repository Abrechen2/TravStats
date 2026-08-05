import { prisma } from "../../db";
import { backfillBookingPrices } from "../backfillBookingPrices";

describe("backfillBookingPrices", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "bookingbackfilltest" } });
    const user = await prisma.user.create({
      data: { username: "bookingbackfilltest", passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function seedBooking(prices: Array<number | null>, currency = "EUR") {
    const booking = await prisma.booking.create({ data: { userId } });
    for (const [i, price] of prices.entries()) {
      await prisma.flight.create({
        data: {
          userId,
          bookingId: booking.id,
          flightNumber: `BF${i}`,
          depIata: "FRA",
          arrIata: "JFK",
          depLat: 50.033,
          depLon: 8.571,
          arrLat: 40.639,
          arrLon: -73.779,
          status: "flown",
          price,
          currency,
        },
      });
    }
    return booking.id;
  }

  it("heals a priceless booking whose segments share an identical total", async () => {
    const id = await seedBooking([250, 250]);
    const healed = await backfillBookingPrices();
    expect(healed).toBeGreaterThanOrEqual(1);
    const b = await prisma.booking.findUnique({ where: { id } });
    expect(b?.price).toBe(250);
    expect(b?.currency).toBe("EUR");
    const flights = await prisma.flight.findMany({ where: { bookingId: id } });
    expect(flights.every((f) => f.price === null)).toBe(true);
  });

  it("is idempotent — a second run heals nothing more for the same data", async () => {
    const before = await prisma.booking.findMany({ where: { userId } });
    const healedAgain = await backfillBookingPrices();
    const after = await prisma.booking.findMany({ where: { userId } });
    expect(after).toEqual(before);
    // healedAgain may count OTHER users' dev-DB bookings; assert OUR rows stable, not the counter.
    expect(typeof healedAgain).toBe("number");
  });

  it("skips differing prices and single-flight bookings", async () => {
    const differing = await seedBooking([100, 200]);
    const single = await seedBooking([300]);
    await backfillBookingPrices();
    expect((await prisma.booking.findUnique({ where: { id: differing } }))?.price).toBeNull();
    expect((await prisma.booking.findUnique({ where: { id: single } }))?.price).toBeNull();
    const singleFlight = await prisma.flight.findFirst({ where: { bookingId: single } });
    expect(singleFlight?.price).toBe(300);
  });
});
