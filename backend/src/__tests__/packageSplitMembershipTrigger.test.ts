import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { Prisma } from "../prisma";
import { generateToken } from "../utils/jwt";

/**
 * forgejo#430: every write that moves an entry onto, off or between bookings
 * marks the package split stale and keeps its amounts — whatever path made it — through the trigger
 * `clear_package_split_on_membership`. The statistics only check a split's
 * item count, so without it a swapped item kept stale shares counting.
 */
const stamp = Date.now();
const SPLIT = {
  method: "manual",
  price: 100,
  currency: "EUR",
  shares: [{ kind: "stay", id: "typed-by-the-user", amount: 63.5 }],
};
/** Marked stale, every typed amount kept — never wiped (CLAUDE.md defect class 4). */
const STALE = { ...SPLIT, stale: true };

describe("package split marked stale on every booking_id write (forgejo#430)", () => {
  let userId: string;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { username: `pst-${stamp}`, passwordHash: "x" } }))
      .id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const splitBooking = async (): Promise<string> =>
    (
      await prisma.booking.create({
        data: { userId, price: 100, currency: "EUR", priceSplit: SPLIT as Prisma.InputJsonValue },
      })
    ).id;
  const splitOf = async (id: string): Promise<unknown> =>
    (await prisma.booking.findUniqueOrThrow({ where: { id } })).priceSplit;

  const station = { lat: 1, lon: 1, tz: "UTC" };
  const makers: Record<string, (bookingId: string | null) => Promise<{ id: string }>> = {
    flight: (bookingId) =>
      prisma.flight.create({
        data: {
          userId,
          depIata: "FRA",
          arrIata: "JFK",
          depLat: 50,
          depLon: 8,
          arrLat: 40,
          arrLon: -73,
          bookingId,
        },
      }),
    cruise: (bookingId) => prisma.cruise.create({ data: { userId, bookingId } }),
    stay: async (bookingId) => {
      const lodging = await prisma.lodging.create({ data: { userId, name: "H" } });
      return prisma.lodgingStay.create({ data: { userId, lodgingId: lodging.id, bookingId } });
    },
    rail: (bookingId) =>
      prisma.railJourney.create({
        data: {
          userId,
          depStationName: "A",
          depLat: 1,
          depLon: 1,
          depTimezone: "UTC",
          arrStationName: "B",
          arrLat: 2,
          arrLon: 2,
          arrTimezone: "UTC",
          departureTime: new Date("2025-01-01T08:00:00Z"),
          arrivalTime: new Date("2025-01-01T10:00:00Z"),
          bookingId,
        },
      }),
    bus: (bookingId) =>
      prisma.busJourney.create({
        data: {
          userId,
          depStationName: "A",
          depLat: 1,
          depLon: 1,
          depTimezone: "UTC",
          arrStationName: "B",
          arrLat: 2,
          arrLon: 2,
          arrTimezone: "UTC",
          departureTime: new Date("2025-01-01T08:00:00Z"),
          arrivalTime: new Date("2025-01-01T10:00:00Z"),
          bookingId,
        },
      }),
    ferry: (bookingId) =>
      prisma.ferryJourney.create({
        data: {
          userId,
          depStationName: "A",
          depLat: 1,
          depLon: 1,
          depTimezone: "UTC",
          arrStationName: "B",
          arrLat: 2,
          arrLon: 2,
          arrTimezone: "UTC",
          departureTime: new Date("2025-01-01T08:00:00Z"),
          arrivalTime: new Date("2025-01-01T10:00:00Z"),
          bookingId,
        },
      }),
    rental: (bookingId) =>
      prisma.rentalBooking.create({
        data: {
          userId,
          provider: "Sixt",
          pickupStationName: "A",
          pickupLat: station.lat,
          pickupLon: station.lon,
          pickupTimezone: station.tz,
          returnStationName: "A",
          returnLat: station.lat,
          returnLon: station.lon,
          returnTimezone: station.tz,
          pickupTime: new Date("2025-05-01T09:00:00Z"),
          returnTime: new Date("2025-05-02T09:00:00Z"),
          bookingId,
        },
      }),
  };

  it.each(Object.keys(makers))(
    "%s: joining, leaving and deleting mark the split stale, amounts kept",
    async (kind) => {
      const make = makers[kind];
      // Joining by insert.
      const a = await splitBooking();
      await make(a);
      expect(await splitOf(a)).toEqual(STALE);

      // Joining by update, and leaving by update (moved to another booking).
      const b = await splitBooking();
      const c = await splitBooking();
      const row = await make(null);
      const delegate = (
        prisma as unknown as Record<string, { update: Function; delete: Function }>
      )[
        {
          flight: "flight",
          cruise: "cruise",
          stay: "lodgingStay",
          rail: "railJourney",
          bus: "busJourney",
          ferry: "ferryJourney",
          rental: "rentalBooking",
        }[kind]!
      ];
      await delegate.update({ where: { id: row.id }, data: { bookingId: b } });
      expect(await splitOf(b)).toEqual(STALE);
      await prisma.booking.update({
        where: { id: b },
        data: { priceSplit: SPLIT as Prisma.InputJsonValue },
      });
      await delegate.update({ where: { id: row.id }, data: { bookingId: c } });
      expect(await splitOf(b)).toEqual(STALE);
      expect(await splitOf(c)).toEqual(STALE);

      // Deleting an item.
      await prisma.booking.update({
        where: { id: c },
        data: { priceSplit: SPLIT as Prisma.InputJsonValue },
      });
      await delegate.delete({ where: { id: row.id } });
      expect(await splitOf(c)).toEqual(STALE);
    }
  );

  it("leaves the split alone when an entry is written without moving its booking", async () => {
    const a = await splitBooking();
    const f = await prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50,
        depLon: 8,
        arrLat: 40,
        arrLon: -73,
      },
    });
    await prisma.flight.update({ where: { id: f.id }, data: { bookingId: a } });
    await prisma.booking.update({
      where: { id: a },
      data: { priceSplit: SPLIT as Prisma.InputJsonValue },
    });
    await prisma.flight.update({
      where: { id: f.id },
      data: { bookingId: a, flightNumber: "LH1" },
    });
    expect(await splitOf(a)).toEqual(SPLIT);
  });

  it("POST /trips/bookings/:id/flights marks it stale too", async () => {
    const a = await splitBooking();
    const f = await prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50,
        depLon: 8,
        arrLat: 40,
        arrLon: -73,
      },
    });
    await request(app)
      .post(`/api/v1/trips/bookings/${a}/flights`)
      .set("Cookie", `auth_token=${generateToken(userId)}`)
      .send({ flightIds: [f.id] })
      .expect(200);
    expect(await splitOf(a)).toEqual(STALE);
  });
});
