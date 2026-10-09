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
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
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
      tripId: null,
      tripName: null,
      otherEntries: 0,
      split: null,
    });
    expect(res.body.segments.map((s: { id: string }) => s.id)).toEqual([first.id, second.id]);
    expect(res.body.segments[0].times.departure.utc).toBe("2026-11-02T06:00:00.000Z");
    // Bare — no envelope (ADR 0001).
    expect(res.body.success).toBeUndefined();
  });

  it("names the trip the BOOKING hangs on, also after its flights moved to another (review I4)", async () => {
    const tripA = await prisma.trip.create({ data: { userId, name: "Buchungsreise" } });
    const tripB = await prisma.trip.create({ data: { userId, name: "Andere Reise" } });
    const booking = await prisma.booking.create({ data: { userId, tripId: tripA.id, price: 300 } });
    const seg = await flight(userId, { bookingId: booking.id, tripId: tripA.id });
    const moved = await request(app)
      .post("/api/v1/flights/bulk-edit")
      .set("Cookie", cookie)
      .send({ flightIds: [seg.id], trip: { mode: "set", tripId: tripB.id } });
    expect(moved.body.summary.updated).toBe(1);
    const res = await get(seg.id);
    expect(res.body.booking.tripId).toBe(tripA.id);
    expect(res.body.booking.tripName).toBe("Buchungsreise");
    expect(res.body.segments[0].tripId).toBe(tripB.id);
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

  describe("the price split (forgejo#219)", () => {
    const put = (id: string, body: unknown) =>
      request(app)
        .put(`/api/v1/flights/${id}/booking/split`)
        .set("Cookie", cookie)
        .send(body as object);

    async function bookedPair(price: number | null, currency = "EUR") {
      const booking = await prisma.booking.create({ data: { userId, price, currency } });
      const a = await flight(userId, { bookingId: booking.id, price: 70, taxes: 12, fees: 3 });
      const b = await flight(userId, {
        bookingId: booking.id,
        depIata: "FRA",
        arrIata: "JFK",
        departureTime: new Date("2026-11-02T09:00:00Z"),
        arrivalTime: new Date("2026-11-02T17:30:00Z"),
      });
      return { booking, a, b };
    }

    it("stores an equal split that sums to the total, and touches no price column", async () => {
      const { booking, a, b } = await bookedPair(100.01);
      const res = await put(a.id, { method: "equal" });
      expect(res.status).toBe(200);
      expect(res.body.booking.split).toEqual({
        method: "equal",
        price: 100.01,
        currency: "EUR",
        shares: [
          { flightId: a.id, amount: 50.01 },
          { flightId: b.id, amount: 50 },
        ],
        staleReason: null,
      });
      // Totals keep reading the booking once: neither the booking's price nor
      // any segment's own price, taxes or fees changed.
      const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(after.price).toBe(100.01);
      const rows = await prisma.flight.findMany({
        where: { bookingId: booking.id },
        orderBy: { departureTime: "asc" },
        select: { price: true, taxes: true, fees: true },
      });
      expect(rows).toEqual([
        { price: 70, taxes: 12, fees: 3 },
        { price: null, taxes: null, fees: null },
      ]);
    });

    it("gives a cancelled flight no share — it costs nothing (review M2)", async () => {
      const { booking, a, b } = await bookedPair(100);
      const cancelled = await flight(userId, {
        bookingId: booking.id,
        status: "cancelled",
        departureTime: new Date("2026-11-02T20:00:00Z"),
        arrivalTime: new Date("2026-11-02T21:00:00Z"),
      });
      const res = await put(a.id, { method: "equal" });
      expect(res.status).toBe(200);
      expect(res.body.booking.split.shares).toEqual([
        { flightId: a.id, amount: 50 },
        { flightId: b.id, amount: 50 },
      ]);
      expect(res.body.booking.split.staleReason).toBeNull();
      expect(res.body.segments.map((s: { id: string }) => s.id)).toContain(cancelled.id);
    });

    it("marks the split stale once the booking total changes", async () => {
      const { booking, a } = await bookedPair(100);
      await put(a.id, { method: "equal" });
      await prisma.booking.update({ where: { id: booking.id }, data: { price: 140 } });
      const res = await get(a.id);
      expect(res.body.booking.split.staleReason).toBe("price");
    });

    it("refuses a booking without a total, with a code", async () => {
      const { a } = await bookedPair(null);
      const res = await put(a.id, { method: "equal" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("BOOKING_PRICE_MISSING");
    });

    it("refuses a flight without a booking, and an unknown method", async () => {
      const lone = await flight(userId, {});
      expect((await put(lone.id, { method: "equal" })).body.code).toBe("BOOKING_NOT_FOUND");
      const { a } = await bookedPair(100);
      expect((await put(a.id, { method: "guess" })).status).toBe(400);
    });

    it("removes the split, and removing it twice is no error", async () => {
      const { a } = await bookedPair(100);
      await put(a.id, { method: "equal" });
      const del = () =>
        request(app).delete(`/api/v1/flights/${a.id}/booking/split`).set("Cookie", cookie);
      const first = await del();
      expect(first.status).toBe(200);
      expect(first.body.booking.split).toBeNull();
      expect((await del()).status).toBe(200);
    });
  });
});
