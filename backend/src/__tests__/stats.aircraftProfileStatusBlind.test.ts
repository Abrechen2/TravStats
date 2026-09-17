/**
 * AUD-078. Walking from the aircraft ranking into an aircraft's profile grew
 * the flight count and the distance without a single further flight having been
 * flown.
 *
 * The ranking narrows with the shared `countableFlightWhere()`; the profile
 * query did not, so it added a cancelled leg and a 2099 booking to figures the
 * page presents as already flown — and the page has no status column, so
 * nothing on screen revealed the different population.
 *
 * The assertion is parity between the two endpoints rather than a fixed number:
 * they are two views of one population, and the bug is precisely that they
 * disagreed.
 */
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const USERNAME = "aircraftprofilestatusblind";
const REGISTRATION = "D-AUD078";

// MUC -> TXL, one real leg. Same route three times so a status leak shows up
// as an exact multiple rather than as an arguable rounding difference.
const LEG = {
  flightNumber: "LH100",
  depIata: "MUC",
  arrIata: "TXL",
  depLat: 48.3538,
  depLon: 11.7861,
  arrLat: 52.5597,
  arrLon: 13.2877,
  aircraftRegistration: REGISTRATION,
  aircraft: "A320",
  airline: "Lufthansa",
};

describe("aircraft profile counts the same flights the ranking does", () => {
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(user.id)}`;

    await prisma.flight.createMany({
      data: [
        {
          ...LEG,
          userId: user.id,
          status: "flown",
          departureTime: new Date("2025-06-01T08:00:00Z"),
          arrivalTime: new Date("2025-06-01T09:10:00Z"),
        },
        {
          ...LEG,
          userId: user.id,
          status: "cancelled",
          departureTime: new Date("2025-06-02T08:00:00Z"),
          arrivalTime: new Date("2025-06-02T09:10:00Z"),
        },
        {
          ...LEG,
          userId: user.id,
          status: "scheduled",
          departureTime: new Date("2099-06-03T08:00:00Z"),
          arrivalTime: new Date("2099-06-03T09:10:00Z"),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  it("reports one flight, not three", async () => {
    const res = await request(app)
      .get(`/api/v1/stats/aircraft/${REGISTRATION}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.flightCount).toBe(1);
    expect(res.body.flights).toHaveLength(1);
    // The 2099 booking must not become the aircraft's "last flight".
    expect(String(res.body.lastFlightDate ?? "")).not.toContain("2099");
    // And the cancelled leg must not appear in the history list either.
    expect(res.body.flights.map((f: { status: string }) => f.status)).toEqual(["flown"]);
  });

  it("agrees with the ranking on flights and distance", async () => {
    const [ranking, profile] = await Promise.all([
      request(app).get("/api/v1/stats/aircraft").set("Cookie", cookie),
      request(app).get(`/api/v1/stats/aircraft/${REGISTRATION}`).set("Cookie", cookie),
    ]);

    expect(ranking.status).toBe(200);
    expect(profile.status).toBe(200);

    const rows: { registration: string; count: number; totalDistanceKm: number }[] =
      ranking.body.aircraft;
    const ranked = rows.find((r) => r.registration === REGISTRATION);
    expect(ranked).toBeDefined();

    expect(profile.body.flightCount).toBe(ranked!.count);
    // Same population, same great-circle sum — a leak showed up here as ~3x.
    expect(profile.body.totalDistanceKm).toBeCloseTo(ranked!.totalDistanceKm, 0);
  });
});
