import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { busCreationLimiter } from "../../middleware/rateLimit";

/**
 * A bus ride extends its trip's span and status like a train ride does (spec
 * 2026-10-07 §8): rides carry rail's clock columns and join its bounds.
 */
const SEOUL = { name: "Seoul Express Bus Terminal", lat: 37.5048, lon: 127.0046, country: "KR" };
const SOKCHO = { name: "Sokcho Express Bus Terminal", lat: 38.1911, lon: 128.5918, country: "KR" };

describe("bus rides and their trip", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;

  const post = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/v1/bus")
      .set("Cookie", cookie)
      .send({
        departureStation: SEOUL,
        arrivalStation: SOKCHO,
        departureLocal: "2026-09-20T09:00",
        arrivalLocal: "2026-09-20T11:20",
        ...body,
      });
  const reload = (id: string) => prisma.trip.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `bus-trip-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterEach(async () => {
    await busCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("completes an undated trip whose only segment is a past ride", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: `undated-${stamp}`, status: "planned", startDate: null, endDate: null },
    });
    expect((await post({ tripId: trip.id })).status).toBe(201);
    expect((await reload(trip.id)).status).toBe("completed");
  });

  it("lets the ride, not the trip's own far-off dates, decide the status", async () => {
    // A held segment outranks the trip's own plan (`tripStatusBounds`): the
    // ride is past, so a trip pencilled in for 2030 is no longer "planned".
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: `dated-${stamp}`,
        status: "planned",
        startDate: new Date("2030-01-01"),
        endDate: new Date("2030-01-05"),
      },
    });
    await post({ tripId: trip.id });
    expect((await reload(trip.id)).status).toBe("completed");
  });

  it("re-derives the trip it left and the trip it joined when a ride moves", async () => {
    const from = await prisma.trip.create({
      // Own 2030 dates: once the ride leaves, derivation falls back to them.
      data: {
        userId,
        name: `from-${stamp}`,
        status: "planned",
        startDate: new Date("2030-01-01"),
        endDate: new Date("2030-01-05"),
      },
    });
    const to = await prisma.trip.create({
      data: { userId, name: `to-${stamp}`, status: "planned" },
    });
    const created = await post({ tripId: from.id });
    expect((await reload(from.id)).status).toBe("completed");

    await request(app)
      .patch(`/api/v1/bus/${created.body.data.id}`)
      .set("Cookie", cookie)
      .send({ tripId: to.id });
    expect((await reload(to.id)).status).toBe("completed");
    // The trip it left lost its only segment and is back to its own plan.
    expect((await reload(from.id)).status).toBe("planned");

    await request(app).delete(`/api/v1/bus/${created.body.data.id}`).set("Cookie", cookie);
    // Nothing dated is left in `to`: derivation abstains and the status stays.
    expect((await reload(to.id)).status).toBe("completed");
  });
});
