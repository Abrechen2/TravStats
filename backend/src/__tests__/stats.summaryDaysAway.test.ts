/**
 * forgejo#92 — `GET /stats/summary` publishes days away per domain.
 *
 * The pure arithmetic is pinned in `utils/stats/__tests__/daysAway.test.ts`.
 * What only a live request can get wrong is which ROWS reach it: that a
 * booked flight, a scheduled cruise, a future stay and a wishlist place
 * contribute nothing, that the figure is scoped to the caller, and that the
 * `year` filter clips a stay straddling New Year to the year asked for.
 */
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const USERNAME = "summarydaysaway";
const STRANGER = "summarydaysaway-stranger";

describe("GET /stats/summary — daysAway", () => {
  let userId: string;
  let strangerId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [USERNAME, STRANGER] } } });
    const [user, stranger] = await Promise.all([
      prisma.user.create({
        data: { username: USERNAME, passwordHash: await hashPassword("password123") },
      }),
      prisma.user.create({
        data: { username: STRANGER, passwordHash: await hashPassword("password123") },
      }),
    ]);
    userId = user.id;
    strangerId = stranger.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    const flightBase = {
      depIata: "FRA",
      arrIata: "LHR",
      depLat: 50.0379,
      depLon: 8.5622,
      arrLat: 51.47,
      arrLon: -0.4543,
    };
    await prisma.flight.createMany({
      data: [
        // Out on 10 May, home on 12 May 2024.
        {
          ...flightBase,
          userId,
          departureTime: new Date("2024-05-10T08:00:00Z"),
          arrivalTime: new Date("2024-05-10T09:30:00Z"),
          status: "flown",
        },
        {
          ...flightBase,
          userId,
          departureTime: new Date("2024-05-12T18:00:00Z"),
          arrivalTime: new Date("2024-05-12T19:30:00Z"),
          status: "flown",
        },
        // Booked, not flown: no day.
        {
          ...flightBase,
          userId,
          departureTime: new Date("2030-01-01T08:00:00Z"),
          arrivalTime: new Date("2030-01-01T09:30:00Z"),
          status: "scheduled",
        },
        // Somebody else's flight: not this account's day.
        {
          ...flightBase,
          userId: strangerId,
          departureTime: new Date("2024-05-11T08:00:00Z"),
          arrivalTime: new Date("2024-05-11T09:30:00Z"),
          status: "flown",
        },
      ],
    });

    // The hotel between the two flights — the same three days.
    const hotel = await prisma.lodging.create({
      data: { userId, name: "Days Away Hotel", city: "London", country: "United Kingdom" },
    });
    await prisma.lodgingStay.createMany({
      data: [
        {
          lodgingId: hotel.id,
          userId,
          checkIn: new Date("2024-05-10T00:00:00Z"),
          checkOut: new Date("2024-05-12T00:00:00Z"),
          status: "completed",
        },
        // Straddles New Year 2024/2025: 30, 31 Dec and 1, 2 Jan.
        {
          lodgingId: hotel.id,
          userId,
          checkIn: new Date("2024-12-30T00:00:00Z"),
          checkOut: new Date("2025-01-02T00:00:00Z"),
          status: "completed",
        },
        // Still ahead: a booking, not a visit.
        {
          lodgingId: hotel.id,
          userId,
          checkIn: new Date("2030-03-01T00:00:00Z"),
          checkOut: new Date("2030-03-05T00:00:00Z"),
          status: "scheduled",
        },
      ],
    });

    // A sailed cruise, a week in June 2024; a scheduled one that counts for nothing.
    await prisma.cruise.createMany({
      data: [
        {
          userId,
          cruiseLine: "Days Away Line",
          startDate: new Date("2024-06-01T00:00:00Z"),
          endDate: new Date("2024-06-07T00:00:00Z"),
          status: "flown",
        },
        {
          userId,
          cruiseLine: "Days Away Line",
          startDate: new Date("2030-06-01T00:00:00Z"),
          endDate: new Date("2030-06-07T00:00:00Z"),
          status: "scheduled",
        },
      ],
    });

    // A place visited on the hotel's middle day, and a wishlist place with a
    // visit row that must not count.
    const [place, wish] = await Promise.all([
      prisma.place.create({
        data: { userId, name: "Days Away Place", lat: 51.5, lon: -0.1, visited: true },
      }),
      prisma.place.create({
        data: { userId, name: "Days Away Wish", lat: 51.5, lon: -0.1, visited: false },
      }),
    ]);
    await prisma.placeVisit.createMany({
      data: [
        { placeId: place.id, userId, visitedAt: new Date("2024-05-11T00:00:00Z") },
        { placeId: wish.id, userId, visitedAt: new Date("2024-05-20T00:00:00Z") },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
    await prisma.$disconnect();
  });

  it("reports each domain and a total that is the union, not the sum", async () => {
    const res = await request(app).get("/api/v1/stats/summary").set("Cookie", cookie);
    expect(res.status).toBe(200);

    expect(res.body.daysAway).toEqual({
      flight: 2, // 10 and 12 May
      cruise: 7, // 1–7 June
      lodging: 7, // 10–12 May, 30 Dec–2 Jan
      place: 1, // 11 May
      // 10, 11, 12 May + 7 June days + 4 New Year days
      total: 14,
    });
  });

  it("scopes to the year asked for, clipping a stay that straddles New Year", async () => {
    const res = await request(app)
      .get("/api/v1/stats/summary")
      .query({ year: 2025 })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.daysAway).toEqual({ flight: 0, cruise: 0, lodging: 2, place: 0, total: 2 });
  });

  it("carries daysAway on both halves of a year comparison", async () => {
    const res = await request(app)
      .get("/api/v1/stats/summary")
      .query({ year: 2024, compareYear: 2025 })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.current.daysAway.total).toBe(12);
    expect(res.body.compare.daysAway.total).toBe(2);
  });
});
