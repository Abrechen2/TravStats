import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

// Regression: GET /stats/countries was the only stats query in this file
// without a flight-status filter, so a merely-booked (scheduled) flight
// made its destination country show up as "visited". Every other stats
// query already scopes to `status: { in: ['flown', 'historical'] }`
// (backend/src/routes/stats.ts) — this brings /countries in line.
//
// Two flights are seeded for a fresh user: a past-dated FRA -> JFK leg
// (derives to 'flown' regardless of hint, see statusDerivation.routes.test.ts)
// and a future-dated FRA -> GRU leg (derives to/stays 'scheduled'). The
// United States must be counted as visited; Brazil — only ever touched by
// the still-scheduled leg — must not.

const isoLocal = (d: Date): string => d.toISOString().slice(0, 16);
const daysFromNow = (days: number, hoursOffset = 0): Date =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000 + hoursOffset * 60 * 60 * 1000);

describe("GET /stats/countries — a scheduled flight does not visit a country", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.flight.deleteMany({ where: { user: { username: "countriesscheduledleak" } } });
    await prisma.user.deleteMany({ where: { username: "countriesscheduledleak" } });
    const user = await prisma.user.create({
      data: { username: "countriesscheduledleak", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    // Flights cascade from the user delete (onDelete: Cascade).
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("does not count a scheduled flight as a visited country", async () => {
    // Past-dated FRA -> JFK: derives to 'flown' regardless of the sent hint.
    const flownDep = daysFromNow(-30);
    const flownArr = daysFromNow(-30, 8);
    await request(app)
      .post("/api/v1/flights")
      .set("Cookie", authCookie)
      .send({
        airline: "Lufthansa",
        flightNumber: "LH400",
        departure: { iata: "FRA", lat: 50.0333, lon: 8.5706 },
        arrival: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
        depTimezone: "UTC",
        arrTimezone: "UTC",
        departureLocal: isoLocal(flownDep),
        arrivalLocal: isoLocal(flownArr),
        status: "flown",
      })
      .expect(201);

    // Future-dated FRA -> GRU (Brazil): derives to/stays 'scheduled'.
    const scheduledDep = daysFromNow(30);
    const scheduledArr = daysFromNow(30, 12);
    await request(app)
      .post("/api/v1/flights")
      .set("Cookie", authCookie)
      .send({
        airline: "Lufthansa",
        flightNumber: "LH401",
        departure: { iata: "FRA", lat: 50.0333, lon: 8.5706 },
        arrival: { iata: "GRU", lat: -23.4356, lon: -46.4731 },
        depTimezone: "UTC",
        arrTimezone: "America/Sao_Paulo",
        departureLocal: isoLocal(scheduledDep),
        arrivalLocal: isoLocal(scheduledArr),
        status: "scheduled",
      })
      .expect(201);

    const res = await request(app)
      .get("/api/v1/stats/countries")
      .set("Cookie", authCookie)
      .expect(200);

    const codes = res.body.countries.map((c: { country: string }) => c.country);
    expect(codes).toContain("US");
    expect(codes).not.toContain("BR");
    expect(res.body.countriesIso).toContain("US");
    expect(res.body.countriesIso).not.toContain("BR");
  });
});
