import { prisma } from "../../db";
import { loadBookingItems } from "./bookingItems";

/** A flight without a stored zone reads its start at the airport catalogue's zone. */
describe("booking items: a flight without a stored zone falls back to the airport catalogue zone", () => {
  it("serialises the start in the departure airport's zone, with one airport query for the list", async () => {
    const user = await prisma.user.create({
      data: { username: "bookItemsZone", passwordHash: "x" },
    });
    const code = "ZQX";
    await prisma.airport.deleteMany({ where: { iata: code } });
    await prisma.airport.create({
      data: { iata: code, icao: "ZZQX", name: "Zone Test", lat: 1, lon: 1, timezone: "Asia/Tokyo" },
    });
    try {
      const booking = await prisma.booking.create({ data: { userId: user.id } });
      for (const n of ["1", "2"]) {
        await prisma.flight.create({
          data: {
            userId: user.id,
            bookingId: booking.id,
            flightNumber: `ZZ${n}`,
            depIata: code,
            arrIata: "FRA",
            departureTime: new Date("2026-06-01T00:30:00Z"),
            depTimeSemantics: "UTC",
            depLat: 1,
            depLon: 1,
            arrLat: 2,
            arrLon: 2,
          },
        });
      }
      const items = await loadBookingItems(user.id, booking.id);
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item.start).toMatchObject({ zone: "Asia/Tokyo" });
        expect((item.start as { local: string }).local.startsWith("2026-06-01T09:30")).toBe(true);
      }
    } finally {
      await prisma.flight.deleteMany({ where: { userId: user.id } });
      await prisma.booking.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.airport.deleteMany({ where: { iata: code } });
    }
  });
});
