import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("PATCH /api/v1/trips/bookings/:id", () => {
  let authCookie: string;
  let userId: string;
  let otherUserId: string;
  let bookingId: string;
  let flightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["bookingpatch", "bookingpatch2"] } } });
    const user = await prisma.user.create({
      data: { username: "bookingpatch", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
    const other = await prisma.user.create({
      data: { username: "bookingpatch2", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;

    const booking = await prisma.booking.create({ data: { userId, pnr: "PATCH1" } });
    bookingId = booking.id;
    const flight = await prisma.flight.create({
      data: {
        userId,
        bookingId,
        flightNumber: "BP100",
        depIata: "FRA",
        arrIata: "JFK",
        status: "flown",
        price: 111,
        depLat: 50.0,
        depLon: 8.0,
        arrLat: 40.0,
        arrLon: -74.0,
      },
    });
    flightId = flight.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.user.delete({ where: { id: otherUserId } });
    await prisma.$disconnect();
  });

  it("updates price/currency/pnr and returns the booking", async () => {
    const res = await request(app)
      .patch(`/api/v1/trips/bookings/${bookingId}`)
      .set("Cookie", authCookie)
      .send({ price: 999.5, currency: "USD", pnr: "PATCH1X" });
    expect(res.status).toBe(200);
    expect(res.body.booking.price).toBe(999.5);
    expect(res.body.booking.currency).toBe("USD");
    expect(res.body.booking.pnr).toBe("PATCH1X");
  });

  it("a partial body never nulls unsent fields", async () => {
    const res = await request(app)
      .patch(`/api/v1/trips/bookings/${bookingId}`)
      .set("Cookie", authCookie)
      .send({ price: 500 });
    expect(res.status).toBe(200);
    expect(res.body.booking.currency).toBe("USD");
    expect(res.body.booking.pnr).toBe("PATCH1X");
  });

  it("never mutates the flights' prices", async () => {
    const f = await prisma.flight.findUnique({ where: { id: flightId } });
    expect(f?.price).toBe(111);
  });

  it("404 for a foreign booking", async () => {
    const foreign = await prisma.booking.create({ data: { userId: otherUserId } });
    const res = await request(app)
      .patch(`/api/v1/trips/bookings/${foreign.id}`)
      .set("Cookie", authCookie)
      .send({ price: 1 });
    expect(res.status).toBe(404);
  });

  it("400 for a negative price and a bad currency", async () => {
    expect(
      (
        await request(app)
          .patch(`/api/v1/trips/bookings/${bookingId}`)
          .set("Cookie", authCookie)
          .send({ price: -5 })
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch(`/api/v1/trips/bookings/${bookingId}`)
          .set("Cookie", authCookie)
          .send({ currency: "eur" })
      ).status
    ).toBe(400);
  });

  it("401 unauthenticated", async () => {
    const res = await request(app).patch(`/api/v1/trips/bookings/${bookingId}`).send({ price: 1 });
    expect(res.status).toBe(401);
  });
});
