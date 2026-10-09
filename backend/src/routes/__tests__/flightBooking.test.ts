import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A flight's booking and its segments (forgejo#218): only flights LINKED to
 * the booking come back, in departure order, each with its `times`.
 */
describe("GET /flights/:id/booking", () => {
  let cookie: string;
  let userId: string;
  let otherUserId: string;

  const get = (id: string, auth = cookie) =>
    request(app).get(`/api/v1/flights/${id}/booking`).set("Cookie", auth);

  const flight = (owner: string, over: Record<string, unknown>) =>
    prisma.flight.create({
      data: {
        userId: owner,
        flightNumber: "LH1",
        depIata: "MUC",
        arrIata: "FRA",
        departureTime: new Date("2026-11-02T06:00:00Z"),
        arrivalTime: new Date("2026-11-02T07:05:00Z"),
        depLat: 48.35,
        depLon: 11.79,
        arrLat: 50.03,
        arrLon: 8.56,
        status: "scheduled",
        dataSource: "manual",
        ...over,
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["flbook", "flbookother"] } } });
    const u = await prisma.user.create({
      data: { username: "flbook", passwordHash: await hashPassword("password123") },
    });
    const o = await prisma.user.create({
      data: { username: "flbookother", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    otherUserId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.booking.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("returns the booking and its linked segments in departure order", async () => {
    const booking = await prisma.booking.create({
      data: { userId, pnr: "ABC123", price: 480, currency: "EUR" },
    });
    const second = await flight(userId, {
      bookingId: booking.id,
      flightNumber: "LH400",
      depIata: "FRA",
      arrIata: "JFK",
      departureTime: new Date("2026-11-02T09:00:00Z"),
      arrivalTime: new Date("2026-11-02T17:30:00Z"),
    });
    const first = await flight(userId, { bookingId: booking.id, flightNumber: "LH101" });
    // Same PNR string, but never linked: not a segment of this booking.
    await flight(userId, { bookingReference: "ABC123", flightNumber: "LH999" });

    const res = await get(second.id);
    expect(res.status).toBe(200);
    expect(res.body.booking).toEqual({
      id: booking.id,
      pnr: "ABC123",
      price: 480,
      currency: "EUR",
      otherEntries: 0,
    });
    expect(res.body.segments.map((s: { id: string }) => s.id)).toEqual([first.id, second.id]);
    expect(res.body.segments[0].times.departure.utc).toBe("2026-11-02T06:00:00.000Z");
    // Bare — no envelope (ADR 0001).
    expect(res.body.success).toBeUndefined();
  });

  it("answers an unbooked flight with no booking and no segments", async () => {
    const lone = await flight(userId, {});
    const res = await get(lone.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ booking: null, segments: [] });
  });

  it("does not show another user's flight or booking", async () => {
    const foreign = await flight(otherUserId, {});
    const res = await get(foreign.id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("FLIGHT_NOT_FOUND");
  });
});
