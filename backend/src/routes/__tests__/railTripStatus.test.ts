import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";

/**
 * A train ride extends its trip's span and status like a flight does (owner
 * decision 6 of the rail spec, 2026-09-25), on every write path: create, move
 * between trips, delete — and the trip page reads the ride back.
 */
const FRANKFURT = { name: "Frankfurt (Main) Hbf", lat: 50.1071, lon: 8.6632, country: "DE" };
const BASEL = { name: "Basel SBB", lat: 47.5476, lon: 7.5897, country: "CH" };
const DAY = 86_400_000;

/** `YYYY-MM-DDTHH:mm`, n days from now, as a ticket's wall clock. */
const wallClock = (days: number): string =>
  new Date(Date.now() + days * DAY).toISOString().slice(0, 16);

describe("rail journeys and their trip", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;

  const newTrip = (name: string) =>
    prisma.trip.create({ data: { userId, name: `${name}-${stamp}`, status: "planned" } });
  const post = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({ departureStation: FRANKFURT, arrivalStation: BASEL, ...body });
  const statusOf = async (id: string) =>
    (await prisma.trip.findUniqueOrThrow({ where: { id } })).status;

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `rail-trip-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterEach(async () => {
    await railCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("completes a trip whose only segment is a past ride", async () => {
    const trip = await newTrip("past");
    await post({ departureLocal: wallClock(-10), arrivalLocal: wallClock(-9.9), tripId: trip.id });
    expect(await statusOf(trip.id)).toBe("completed");
  });

  it("re-derives both trips when a ride moves, and the old one when it is deleted", async () => {
    const from = await newTrip("from");
    const to = await newTrip("to");
    const created = await post({
      departureLocal: wallClock(-10),
      arrivalLocal: wallClock(-9.9),
      tripId: from.id,
    });
    expect(await statusOf(from.id)).toBe("completed");

    // Moved into a trip that also holds a future flight home: in progress.
    await prisma.flight.create({
      data: {
        userId,
        tripId: to.id,
        depLat: 47.5,
        depLon: 7.5,
        arrLat: 50.1,
        arrLon: 8.6,
        departureTime: new Date(Date.now() + 5 * DAY),
      },
    });
    await request(app)
      .patch(`/api/v1/rail/${created.body.data.id}`)
      .set("Cookie", cookie)
      .send({ tripId: to.id });
    expect(await statusOf(to.id)).toBe("in_progress");

    await request(app).delete(`/api/v1/rail/${created.body.data.id}`).set("Cookie", cookie);
    expect(await statusOf(to.id)).toBe("planned");
  });

  it("sends the trip page its rides, without the frozen line", async () => {
    const trip = await newTrip("page");
    await post({ departureLocal: wallClock(3), tripId: trip.id });
    const res = await request(app).get(`/api/v1/trips/${trip.id}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.trip.railJourneys).toHaveLength(1);
    expect(res.body.trip.railJourneys[0].depStationName).toBe(FRANKFURT.name);
    expect(res.body.trip.railJourneys[0]).not.toHaveProperty("geometry");
  });
});
