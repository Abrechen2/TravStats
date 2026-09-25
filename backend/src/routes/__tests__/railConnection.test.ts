import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";

/**
 * "Add a connecting train" (spec 2026-09-25-rail-domain, phase 2b): the server
 * binds both legs through one booking, in one request.
 */
const FRANKFURT = { name: "Frankfurt (Main) Hbf", lat: 50.1071, lon: 8.6632, country: "DE" };
const MANNHEIM = { name: "Mannheim Hbf", lat: 49.4794, lon: 8.4697, country: "DE" };
const BASEL = { name: "Basel SBB", lat: 47.5476, lon: 7.5897, country: "CH" };

describe("rail connections", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerId: string;
  let cookie: string;
  let strangerCookie: string;
  let tripId: string;

  const post = (body: Record<string, unknown>, as = cookie) =>
    request(app).post("/api/v1/rail").set("Cookie", as).send(body);

  const firstLeg = (extra: Record<string, unknown> = {}) =>
    post({
      departureStation: FRANKFURT,
      arrivalStation: MANNHEIM,
      departureLocal: "2025-03-01T08:00",
      arrivalLocal: "2025-03-01T08:40",
      bookingReference: "AB12CD",
      tripId,
      ...extra,
    });

  const secondLeg = (connectsFrom: string, extra: Record<string, unknown> = {}, as = cookie) =>
    post(
      {
        departureStation: MANNHEIM,
        arrivalStation: BASEL,
        departureLocal: "2025-03-01T08:55",
        arrivalLocal: "2025-03-01T11:10",
        connectsFrom,
        ...extra,
      },
      as
    );

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `rail-cx-${stamp}`, passwordHash } }))
      .id;
    strangerId = (
      await prisma.user.create({ data: { username: `rail-cx-other-${stamp}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: `rail-cx-trip-${stamp}` } })).id;
  });

  afterEach(async () => {
    await railCreationLimiter.resetKey(`user:${userId}`);
    await railCreationLimiter.resetKey(`user:${strangerId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("binds the previous leg and the new one through one new booking", async () => {
    const first = await firstLeg();
    const second = await secondLeg(first.body.data.id);
    expect(second.status).toBe(201);

    const previous = await prisma.railJourney.findUniqueOrThrow({
      where: { id: first.body.data.id },
    });
    expect(previous.bookingId).not.toBeNull();
    expect(second.body.data.bookingId).toBe(previous.bookingId);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: previous.bookingId! } });
    // Named by the ticket's own reference, in the leg's own trip.
    expect(booking.pnr).toBe("AB12CD");
    expect(booking.userId).toBe(userId);
    expect(booking.tripId).toBe(tripId);
  });

  it("files the new leg in the previous leg's trip unless it names one", async () => {
    const first = await firstLeg();
    const inherited = await secondLeg(first.body.data.id);
    expect(inherited.body.data.tripId).toBe(tripId);

    const explicit = await secondLeg(first.body.data.id, { tripId: null });
    expect(explicit.body.data.tripId).toBeNull();
  });

  it("joins a booking the previous leg already has instead of making a second", async () => {
    const first = await firstLeg();
    const second = await secondLeg(first.body.data.id);
    const third = await post({
      departureStation: BASEL,
      arrivalStation: MANNHEIM,
      departureLocal: "2025-03-02T09:00",
      connectsFrom: second.body.data.id,
    });
    expect(third.body.data.bookingId).toBe(second.body.data.bookingId);
    expect(await prisma.booking.count({ where: { userId } })).toBeGreaterThan(0);
    const legs = await prisma.railJourney.count({
      where: { bookingId: second.body.data.bookingId },
    });
    expect(legs).toBe(3);
  });

  it("refuses to continue a stranger's journey, and binds nothing", async () => {
    const first = await firstLeg();
    const res = await secondLeg(first.body.data.id, { tripId: undefined }, strangerCookie);
    expect(res.status).toBe(404);
    const previous = await prisma.railJourney.findUniqueOrThrow({
      where: { id: first.body.data.id },
    });
    expect(previous.bookingId).toBeNull();
  });
});
