import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#132 item 9: the globe's route sheet needs the flights behind an arc,
 * its airlines, how long it takes and when it was last flown. What matters is
 * that the sheet and the arc can never disagree — `count` here must be the
 * number `/stats/network` puts on the same pair — and that the list is paged.
 */
const FRA = { lat: 50.0333, lon: 8.5706 };
const WAW = { lat: 52.1657, lon: 20.9671 };

describe("GET /api/v1/stats/network/route/:a/:b", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "networkroutetest" } });
    const user = await prisma.user.create({
      data: { username: "networkroutetest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    const leg = (over: Record<string, unknown>) => ({
      userId,
      depIata: "FRA",
      arrIata: "WAW",
      depLat: FRA.lat,
      depLon: FRA.lon,
      arrLat: WAW.lat,
      arrLon: WAW.lon,
      status: "flown",
      ...over,
    });
    await prisma.flight.createMany({
      data: [
        leg({
          flightNumber: "LH1346",
          airline: "Lufthansa",
          airlineIata: "LH",
          departureTime: new Date("2024-03-01T07:00:00Z"),
          arrivalTime: new Date("2024-03-01T08:50:00Z"),
        }),
        // The other direction is the same route.
        leg({
          depIata: "WAW",
          arrIata: "FRA",
          depLat: WAW.lat,
          depLon: WAW.lon,
          arrLat: FRA.lat,
          arrLon: FRA.lon,
          flightNumber: "LO379",
          airline: "LOT Polish Airlines",
          airlineIata: "LO",
          departureTime: new Date("2025-06-10T12:00:00Z"),
          arrivalTime: new Date("2025-06-10T14:10:00Z"),
        }),
        // ICAO only: the catalogue folds it onto the FRA node, as the network does.
        leg({
          depIata: null,
          depIcao: "EDDF",
          flightNumber: "LH1350",
          airlineIata: "LH",
          departureTime: new Date("2023-11-05T15:00:00Z"),
          arrivalTime: new Date("2023-11-05T16:55:00Z"),
        }),
        // Late on 31 Dec in UTC, already 2026 on Warsaw's calendar.
        leg({
          depIata: "WAW",
          arrIata: "FRA",
          depLat: WAW.lat,
          depLon: WAW.lon,
          arrLat: FRA.lat,
          arrLon: FRA.lon,
          flightNumber: "LO381",
          airline: null,
          departureTime: new Date("2025-12-31T23:30:00Z"),
          arrivalTime: null,
        }),
        // Booked, not flown — the network does not count it, and neither may this.
        leg({ flightNumber: "LH9999", status: "scheduled", departureTime: new Date("2030-01-01") }),
        // Another route entirely.
        leg({
          arrIata: "LHR",
          arrLat: 51.47,
          arrLon: -0.4543,
          flightNumber: "LH900",
          departureTime: new Date("2025-01-01T09:00:00Z"),
        }),
      ],
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const get = (path: string) =>
    request(app).get(`/api/v1/stats/network${path}`).set("Cookie", cookie);

  it("carries the arc's own count, both directions, by the network's pairing rule", async () => {
    const network = await get("");
    const arc = network.body.routes.find(
      (r: { aIata: string; bIata: string }) => r.aIata === "FRA" && r.bIata === "WAW"
    );

    const res = await get("/route/WAW/FRA");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ aIata: "FRA", bIata: "WAW", count: 4 });
    expect(res.body.count).toBe(arc.count);
    expect(res.body.flights.map((f: { flightNumber: string }) => f.flightNumber)).toEqual([
      "LO381",
      "LO379",
      "LH1346",
      "LH1350",
    ]);
  });

  it("names the distinct airlines, keeps a flight without one apart, and the last year flown", async () => {
    const res = await get("/route/fra/waw");
    expect(res.body.airlineCount).toBe(2);
    expect(res.body.airlines.map((a: { iata: string }) => a.iata)).toEqual(["LH", "LO"]);
    expect(res.body.flightsWithoutAirline).toBe(1);
    // The departure airport's calendar: Warsaw was already in 2026.
    expect(res.body.lastYear).toBe(2026);
    expect(res.body.flights[0]).toMatchObject({ date: "2026-01-01", status: "flown" });
  });

  it("averages durations over the flights that have one and says how many were estimated", async () => {
    const res = await get("/route/FRA/WAW");
    // Measured 110, 130, 115; the fourth has no arrival and is estimated from
    // its coordinates, so it contributes — flagged as an estimate, never as 0.
    expect(res.body.duration.measuredFlights).toBe(3);
    expect(res.body.duration.estimatedFlights).toBe(1);
    expect(res.body.duration.averageMinutes).toBeGreaterThan(100);
  });

  it("pages the flight list and keeps the facts about the whole route", async () => {
    const first = await get("/route/FRA/WAW?limit=2");
    const second = await get("/route/FRA/WAW?limit=2&offset=2");
    expect(first.body).toMatchObject({ count: 4, returned: 2, page: { offset: 0, limit: 2 } });
    expect(second.body.returned).toBe(2);
    const ids = [...first.body.flights, ...second.body.flights].map((f: { id: string }) => f.id);
    expect(new Set(ids).size).toBe(4);
    expect(second.body.airlineCount).toBe(2);
  });

  it("answers 404 for a pair nobody flew and 400 for a code that is none", async () => {
    expect((await get("/route/FRA/JFK")).status).toBe(404);
    expect((await get("/route/FRA/FRA")).status).toBe(404);
    expect((await get("/route/F!/WAW")).status).toBe(400);
    expect((await get("/route/FRA/WAW?limit=5000")).status).toBe(400);
  });
});
