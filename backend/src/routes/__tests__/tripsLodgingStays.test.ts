import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

// Feature gap: a LodgingStay linked to a Trip (via StayEditor's tripId
// picker) previously never surfaced anywhere on the trip — the DB relation
// existed but GET /trips and GET /trips/:id silently dropped it. These tests
// pin the fix: the trip detail response includes the stay (with its
// lodging), the trip list's `_count` includes the stay count, and a stay
// NOT linked to a trip never leaks onto any trip.
describe("Trips API — lodging stays", () => {
  let authCookie: string;
  let userId: string;
  let tripId: string;
  let otherTripId: string;
  let lodgingId: string;
  let stayId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripslodgingtest" } });
    const u = await prisma.user.create({
      data: { username: "tripslodgingtest", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const trip = await prisma.trip.create({ data: { userId, name: "Zürich Trip" } });
    tripId = trip.id;
    const otherTrip = await prisma.trip.create({ data: { userId, name: "Unrelated Trip" } });
    otherTripId = otherTrip.id;

    const lodging = await prisma.lodging.create({
      data: { userId, name: "Grand Hotel Zürich", city: "Zürich" },
    });
    lodgingId = lodging.id;

    const stay = await prisma.lodgingStay.create({
      data: {
        lodgingId,
        userId,
        tripId,
        checkIn: new Date("2024-05-13T15:00:00.000Z"),
        checkOut: new Date("2024-05-15T11:00:00.000Z"),
      },
    });
    stayId = stay.id;

    // A stay on the SAME lodging with no tripId — must never appear on any
    // trip's response, including the one for `otherTripId`.
    await prisma.lodgingStay.create({
      data: {
        lodgingId,
        userId,
        tripId: null,
        checkIn: new Date("2024-06-01T15:00:00.000Z"),
        checkOut: new Date("2024-06-02T11:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("GET /trips/:id includes the linked stay together with its lodging", async () => {
    const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", authCookie);
    expect(res.status).toBe(200);
    const stays = res.body.trip.lodgingStays;
    expect(Array.isArray(stays)).toBe(true);
    expect(stays).toHaveLength(1);
    expect(stays[0].id).toBe(stayId);
    expect(stays[0].lodging.name).toBe("Grand Hotel Zürich");
  });

  it("GET /trips/:id never leaks a stay linked to a different trip (or no trip at all)", async () => {
    const res = await request(app).get(`/api/v1/trips/${otherTripId}`).set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.trip.lodgingStays).toEqual([]);
  });

  it("GET /trips reports the lodging-stay count per trip in _count", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    const trip = res.body.trips.find((t: { id: string }) => t.id === tripId);
    const other = res.body.trips.find((t: { id: string }) => t.id === otherTripId);
    expect(trip._count.lodgingStays).toBe(1);
    expect(other._count.lodgingStays).toBe(0);
  });
});
