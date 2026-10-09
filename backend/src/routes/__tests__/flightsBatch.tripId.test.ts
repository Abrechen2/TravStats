import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The #355 defect in the batch route: `POST /flights/batch` accepted a row
 * carrying `tripId`, answered 201 and stored the flight on no trip — or, when
 * the row shared a booking reference with another, on a trip the PNR grouping
 * invented instead of the one the caller named.
 */
const stamp = Date.now();

describe("POST /flights/batch — tripId per row", () => {
  let cookie: string;
  let userId: string;
  let strangerId: string;
  let tripId: string;
  let strangersTripId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    const user = await prisma.user.create({ data: { username: `fb-trip-${stamp}`, passwordHash } });
    const stranger = await prisma.user.create({
      data: { username: `fb-trip-x-${stamp}`, passwordHash },
    });
    userId = user.id;
    strangerId = stranger.id;
    cookie = `auth_token=${generateToken(userId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Mine" } })).id;
    strangersTripId = (await prisma.trip.create({ data: { userId: strangerId, name: "Theirs" } }))
      .id;
  });

  afterEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.booking.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId, id: { not: tripId } } });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
    await prisma.booking.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
    await prisma.userSettings.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
    await prisma.$disconnect();
  });

  let seq = 0;
  const row = (extra: Record<string, unknown>) => {
    seq += 1;
    const day = String(seq).padStart(2, "0");
    return {
      flightNumber: `LH${3000 + seq}`,
      departure: { iata: "FRA", lat: 50.03, lon: 8.57 },
      arrival: { iata: "MUC", lat: 48.35, lon: 11.79 },
      departureLocal: `2026-12-${day}T08:00`,
      arrivalLocal: `2026-12-${day}T09:00`,
      depTimezone: "Europe/Berlin",
      arrTimezone: "Europe/Berlin",
      ...extra,
    };
  };
  const post = (body: unknown) =>
    request(app).post("/api/v1/flights/batch").set("Cookie", cookie).send(body);

  it("files each row on the trip it names, and leaves the others alone", async () => {
    const res = await post([row({ tripId }), row({})]).expect(201);
    const [onTrip, loose] = res.body.flights as Array<{ id: string }>;
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: onTrip.id } })).tripId).toBe(
      tripId
    );
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: loose.id } })).tripId).toBeNull();
  });

  it("refuses the whole batch when a row names another account's trip", async () => {
    const res = await post([row({ tripId }), row({ tripId: strangersTripId })]).expect(404);
    expect(res.body.code).toBe("TRIP_NOT_FOUND");
    expect(res.body.field).toBe("tripId");
    expect(res.body.row).toBe(1);
    expect(await prisma.flight.count({ where: { userId } })).toBe(0);
  });

  it("an explicit tripId wins over the PNR grouping", async () => {
    const res = await post([
      row({ tripId, bookingReference: "PKG123" }),
      row({ tripId, bookingReference: "PKG123" }),
    ]).expect(201);
    expect(res.body.count).toBe(2);
    const flights = await prisma.flight.findMany({ where: { userId } });
    expect(flights.map((f) => f.tripId)).toEqual([tripId, tripId]);
    // No second trip invented for the same booking.
    expect(await prisma.trip.count({ where: { userId } })).toBe(1);
    expect(flights.every((f) => f.bookingReference === "PKG123")).toBe(true);
  });
});
