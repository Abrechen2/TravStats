import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

describe("flights batch — booking-level total price", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "bookingpricetest" } });
    const user = await prisma.user.create({
      data: { username: "bookingpricetest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    // Flights/trips/bookings cascade from the user delete (onDelete: Cascade).
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // Each case books a DIFFERENT journey. They used to share one template —
  // the same flight number, day and route under four booking references —
  // which no logbook can contain: a person cannot fly FRA-JFK as LH400 on the
  // same day twice. Since imported rows now carry provenance, the repeats were
  // correctly recognised as the same flight and skipped, and the cases had
  // nothing to assert on. The fixtures are realistic now; the behaviour under
  // test (moving a shared total onto the booking) is untouched.
  function makeFlight(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      flightNumber: "LH400",
      departure: { iata: "FRA", lat: 50.0333, lon: 8.5706 },
      arrival: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
      departureLocal: "2024-05-01T10:00",
      depTimezone: "Europe/Berlin",
      arrivalLocal: "2024-05-01T18:00",
      arrTimezone: "America/New_York",
      status: "flown",
      ...overrides,
    };
  }

  it("moves an identical per-segment total onto the booking and nulls segment prices", async () => {
    const res = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", authCookie)
      .send([
        makeFlight({ bookingReference: "BOOKA1", price: 500, currency: "EUR" }),
        makeFlight({
          flightNumber: "LH401",
          departure: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
          arrival: { iata: "FRA", lat: 50.0333, lon: 8.5706 },
          departureLocal: "2024-05-10T20:00",
          depTimezone: "America/New_York",
          arrivalLocal: "2024-05-11T06:00",
          arrTimezone: "Europe/Berlin",
          bookingReference: "BOOKA1",
          price: 500,
          currency: "EUR",
        }),
      ]);
    expect(res.status).toBe(201);

    const booking = await prisma.booking.findFirst({ where: { userId, pnr: "BOOKA1" } });
    expect(booking?.price).toBe(500);
    expect(booking?.currency).toBe("EUR");

    const flights = await prisma.flight.findMany({ where: { userId, bookingId: booking!.id } });
    expect(flights).toHaveLength(2);
    expect(flights.every((f) => f.price === null)).toBe(true);

    // Response rows must reflect the FINAL state (Codex finding: stale updateMany)
    const responseRows = res.body.flights as Array<{
      bookingId: string | null;
      price: number | null;
    }>;
    expect(responseRows.every((f) => f.bookingId === booking!.id)).toBe(true);
    expect(responseRows.every((f) => f.price === null)).toBe(true);
  });

  it("leaves differing per-segment prices alone (booking stays priceless)", async () => {
    const res = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", authCookie)
      .send([
        makeFlight({
          bookingReference: "BOOKB2",
          price: 300,
          currency: "EUR",
          departureLocal: "2024-06-01T10:00",
          arrivalLocal: "2024-06-01T18:00",
        }),
        makeFlight({
          flightNumber: "LH405",
          bookingReference: "BOOKB2",
          price: 200,
          currency: "EUR",
          departureLocal: "2024-06-01T10:00",
          arrivalLocal: "2024-06-01T18:00",
        }),
      ]);
    expect(res.status).toBe(201);
    const booking = await prisma.booking.findFirst({ where: { userId, pnr: "BOOKB2" } });
    expect(booking?.price).toBeNull();
    const flights = await prisma.flight.findMany({ where: { userId, bookingId: booking!.id } });
    expect(flights.map((f) => f.price).sort()).toEqual([200, 300]);
  });

  it("null-price segment in the group means no move (treated as differing)", async () => {
    const res = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", authCookie)
      .send([
        makeFlight({
          bookingReference: "BOOKC3",
          price: 400,
          currency: "EUR",
          departureLocal: "2024-07-01T10:00",
          arrivalLocal: "2024-07-01T18:00",
        }),
        makeFlight({
          flightNumber: "LH407",
          bookingReference: "BOOKC3",
          departureLocal: "2024-07-01T10:00",
          arrivalLocal: "2024-07-01T18:00",
        }),
      ]);
    expect(res.status).toBe(201);
    const booking = await prisma.booking.findFirst({ where: { userId, pnr: "BOOKC3" } });
    expect(booking?.price).toBeNull();
  });

  it("single-flight PNR: no booking, price stays on the flight", async () => {
    const res = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", authCookie)
      .send([
        makeFlight({
          bookingReference: "BOOKD4",
          price: 150,
          currency: "USD",
          departureLocal: "2024-08-01T10:00",
          arrivalLocal: "2024-08-01T18:00",
        }),
      ]);
    expect(res.status).toBe(201);
    expect(await prisma.booking.findFirst({ where: { userId, pnr: "BOOKD4" } })).toBeNull();
    const f = await prisma.flight.findFirst({ where: { userId, bookingReference: "BOOKD4" } });
    expect(f?.price).toBe(150);
  });
});
