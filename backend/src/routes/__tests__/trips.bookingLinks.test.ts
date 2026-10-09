import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * #356: a booking could be created ON a trip, but never moved onto one
 * afterwards, and flights could be filed on a booking only while creating it.
 * Entering a package tour by hand hit both walls: the booking existed, the
 * flights existed, and the API had no call that put them together.
 */
const stamp = Date.now();

describe("booking links (#356)", () => {
  let cookie: string;
  let userId: string;
  let strangerId: string;
  let tripId: string;
  let strangersTripId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `bk-${stamp}`, passwordHash } })).id;
    strangerId = (await prisma.user.create({ data: { username: `bk-x-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Mine" } })).id;
    strangersTripId = (await prisma.trip.create({ data: { userId: strangerId, name: "Theirs" } }))
      .id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
    await prisma.$disconnect();
  });

  const flightOf = (owner: string, flightNumber: string) =>
    prisma.flight.create({
      data: {
        userId: owner,
        flightNumber,
        depIata: "FRA",
        arrIata: "ADD",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 8.98,
        arrLon: 38.8,
        departureTime: new Date("2026-05-18T19:35:00Z"),
        arrivalTime: new Date("2026-05-19T03:25:00Z"),
      },
    });

  describe("PATCH /trips/bookings/:id — tripId", () => {
    it("moves the booking onto the caller's trip", async () => {
      const booking = await prisma.booking.create({ data: { userId, pnr: "LINK1" } });
      const res = await request(app)
        .patch(`/api/v1/trips/bookings/${booking.id}`)
        .set("Cookie", cookie)
        .send({ tripId })
        .expect(200);
      expect(res.body.booking.tripId).toBe(tripId);
    });

    it("takes the booking off its trip with null", async () => {
      const booking = await prisma.booking.create({ data: { userId, pnr: "LINK2", tripId } });
      await request(app)
        .patch(`/api/v1/trips/bookings/${booking.id}`)
        .set("Cookie", cookie)
        .send({ tripId: null })
        .expect(200);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).tripId).toBe(
        null
      );
    });

    it("refuses another account's trip", async () => {
      const booking = await prisma.booking.create({ data: { userId, pnr: "LINK3" } });
      const res = await request(app)
        .patch(`/api/v1/trips/bookings/${booking.id}`)
        .set("Cookie", cookie)
        .send({ tripId: strangersTripId })
        .expect(404);
      expect(res.body.code).toBe("TRIP_NOT_FOUND");
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).tripId).toBe(
        null
      );
    });
  });

  describe("POST /trips/bookings/:id/flights", () => {
    it("files the flights on the booking and on the booking's trip", async () => {
      const booking = await prisma.booking.create({ data: { userId, pnr: "LINK4", tripId } });
      const a = await flightOf(userId, "ET707");
      const b = await flightOf(userId, "ET308");
      const res = await request(app)
        .post(`/api/v1/trips/bookings/${booking.id}/flights`)
        .set("Cookie", cookie)
        .send({ flightIds: [a.id, b.id] })
        .expect(200);
      expect(res.body.count).toBe(2);
      const stored = await prisma.flight.findMany({ where: { id: { in: [a.id, b.id] } } });
      expect(stored.every((f) => f.bookingId === booking.id && f.tripId === tripId)).toBe(true);
    });

    it("refuses a flight that is not the caller's, and files none of them", async () => {
      const booking = await prisma.booking.create({ data: { userId, pnr: "LINK5" } });
      const mine = await flightOf(userId, "ET309");
      const theirs = await flightOf(strangerId, "ET706");
      const res = await request(app)
        .post(`/api/v1/trips/bookings/${booking.id}/flights`)
        .set("Cookie", cookie)
        .send({ flightIds: [mine.id, theirs.id] })
        .expect(404);
      expect(res.body.code).toBe("FLIGHT_NOT_FOUND");
      expect((await prisma.flight.findUniqueOrThrow({ where: { id: mine.id } })).bookingId).toBe(
        null
      );
      expect((await prisma.flight.findUniqueOrThrow({ where: { id: theirs.id } })).bookingId).toBe(
        null
      );
    });

    it("answers 404 for another account's booking", async () => {
      const booking = await prisma.booking.create({ data: { userId: strangerId, pnr: "LINK6" } });
      const mine = await flightOf(userId, "ET500");
      const res = await request(app)
        .post(`/api/v1/trips/bookings/${booking.id}/flights`)
        .set("Cookie", cookie)
        .send({ flightIds: [mine.id] })
        .expect(404);
      expect(res.body.code).toBe("BOOKING_NOT_FOUND");
    });
  });
});
