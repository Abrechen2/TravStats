import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * #355: `POST /flights` answered 201 for a body carrying `tripId` and stored
 * the flight on no trip — `createFlightSchema` had no such field, so zod
 * stripped it without a word. Entering a package tour by hand took a second
 * call per flight to put it where the first call had been asked to.
 */
const stamp = Date.now();

describe("POST /flights — tripId (#355)", () => {
  let cookie: string;
  let userId: string;
  let strangerId: string;
  let tripId: string;
  let strangersTripId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    const user = await prisma.user.create({ data: { username: `fl-trip-${stamp}`, passwordHash } });
    const stranger = await prisma.user.create({
      data: { username: `fl-trip-x-${stamp}`, passwordHash },
    });
    userId = user.id;
    strangerId = stranger.id;
    cookie = `auth_token=${generateToken(userId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Mine" } })).id;
    strangersTripId = (await prisma.trip.create({ data: { userId: strangerId, name: "Theirs" } }))
      .id;
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
    await prisma.$disconnect();
  });

  let seq = 0;
  const body = (extra: Record<string, unknown>) => {
    seq += 1;
    return {
      flightNumber: `LH${2000 + seq}`,
      departure: { iata: "FRA", lat: 50.03, lon: 8.57 },
      arrival: { iata: "MUC", lat: 48.35, lon: 11.79 },
      departureLocal: `2026-11-${String(seq).padStart(2, "0")}T08:00`,
      arrivalLocal: `2026-11-${String(seq).padStart(2, "0")}T09:00`,
      depTimezone: "Europe/Berlin",
      arrTimezone: "Europe/Berlin",
      ...extra,
    };
  };

  it("files the new flight on the trip it names", async () => {
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send(body({ tripId }))
      .expect(201);
    const stored = await prisma.flight.findUniqueOrThrow({ where: { id: res.body.flight.id } });
    expect(stored.tripId).toBe(tripId);
  });

  it("refuses another account's trip as not found, and writes nothing", async () => {
    const before = await prisma.flight.count({ where: { userId } });
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send(body({ tripId: strangersTripId }))
      .expect(404);
    expect(res.body.code).toBe("TRIP_NOT_FOUND");
    expect(await prisma.flight.count({ where: { userId } })).toBe(before);
  });

  it("still creates a flight without a trip", async () => {
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send(body({}))
      .expect(201);
    const stored = await prisma.flight.findUniqueOrThrow({ where: { id: res.body.flight.id } });
    expect(stored.tripId).toBeNull();
  });
});
