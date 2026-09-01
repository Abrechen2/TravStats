/**
 * GET /stats/network — the endpoint a route map or globe is drawn from.
 *
 * Covers what only a real request can show: that the network is scoped to the
 * calling user, that it needs a session at all, and that the undirected pairing
 * survives the round trip through Prisma and JSON.
 */

import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const AIRPORTS = {
  FRA: { iata: "FRA", icao: "EDDF", lat: 50.0379, lon: 8.5622 },
  WAW: { iata: "WAW", icao: "EPWA", lat: 52.1657, lon: 20.9671 },
  JFK: { iata: "JFK", icao: "KJFK", lat: 40.6398, lon: -73.7789 },
  SIN: { iata: "SIN", icao: "WSSS", lat: 1.3644, lon: 103.9915 },
} as const;

type Code = keyof typeof AIRPORTS;

interface NetworkAirport {
  iata: string;
  lat: number;
  lon: number;
  visits: number;
}

interface NetworkRoute {
  aIata: string;
  bIata: string;
  count: number;
  distanceKm: number;
}

const OWNER = "statsnetworkowner";
const STRANGER = "statsnetworkstranger";

function flightData(userId: string, from: Code, to: Code, status: string) {
  const dep = AIRPORTS[from];
  const arr = AIRPORTS[to];
  return {
    userId,
    depIata: dep.iata,
    depIcao: dep.icao,
    depLat: dep.lat,
    depLon: dep.lon,
    arrIata: arr.iata,
    arrIcao: arr.icao,
    arrLat: arr.lat,
    arrLon: arr.lon,
    departureTime: new Date("2026-03-01T08:00:00Z"),
    arrivalTime: new Date("2026-03-01T10:00:00Z"),
    status,
  };
}

describe("GET /stats/network", () => {
  let ownerCookie: string;
  let strangerCookie: string;

  beforeAll(async () => {
    await prisma.flight.deleteMany({ where: { user: { username: { in: [OWNER, STRANGER] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [OWNER, STRANGER] } } });

    const [owner, stranger] = await Promise.all([
      prisma.user.create({
        data: { username: OWNER, passwordHash: await hashPassword("password123") },
      }),
      prisma.user.create({
        data: { username: STRANGER, passwordHash: await hashPassword("password123") },
      }),
    ]);
    ownerCookie = `auth_token=${generateToken(owner.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;

    await prisma.flight.createMany({
      data: [
        // A return trip: ONE route, count 2.
        flightData(owner.id, "FRA", "WAW", "flown"),
        flightData(owner.id, "WAW", "FRA", "flown"),
        // A one-way long haul, plus a booking that has not happened yet.
        flightData(owner.id, "FRA", "JFK", "historical"),
        flightData(owner.id, "FRA", "SIN", "scheduled"),
        // The stranger's network must not leak into the owner's.
        flightData(stranger.id, "JFK", "SIN", "flown"),
      ],
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { user: { username: { in: [OWNER, STRANGER] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [OWNER, STRANGER] } } });
  });

  it("requires a session", async () => {
    const res = await request(app).get("/api/v1/stats/network");
    expect(res.status).toBe(401);
  });

  it("returns the return trip as one undirected route flown twice", async () => {
    const res = await request(app).get("/api/v1/stats/network").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);

    const routes = res.body.routes as NetworkRoute[];
    const fraWaw = routes.filter((r) => [r.aIata, r.bIata].sort().join("-") === "FRA-WAW");
    expect(fraWaw).toHaveLength(1);
    expect(fraWaw[0]).toMatchObject({ aIata: "FRA", bIata: "WAW", count: 2 });
    expect(fraWaw[0].distanceKm).toBeGreaterThan(850);
  });

  it("lists every airport once, with coordinates and total visits", async () => {
    const res = await request(app).get("/api/v1/stats/network").set("Cookie", ownerCookie);

    const airports = res.body.airports as NetworkAirport[];
    expect(airports.map((a) => a.iata).sort()).toEqual(["FRA", "JFK", "WAW"]);
    // FRA: twice on the return trip, once on the long haul.
    expect(airports.find((a) => a.iata === "FRA")?.visits).toBe(3);
    for (const airport of airports) {
      expect(Number.isFinite(airport.lat)).toBe(true);
      expect(Number.isFinite(airport.lon)).toBe(true);
    }
    // SIN was only ever booked, so it is on nobody's map yet.
    expect(airports.some((a) => a.iata === "SIN")).toBe(false);
  });

  it("scopes the network to the calling user", async () => {
    const [owner, stranger] = await Promise.all([
      request(app).get("/api/v1/stats/network").set("Cookie", ownerCookie),
      request(app).get("/api/v1/stats/network").set("Cookie", strangerCookie),
    ]);

    const strangerRoutes = stranger.body.routes as NetworkRoute[];
    expect(strangerRoutes).toEqual([
      expect.objectContaining({ aIata: "JFK", bIata: "SIN", count: 1 }),
    ]);
    expect((stranger.body.airports as NetworkAirport[]).map((a) => a.iata).sort()).toEqual([
      "JFK",
      "SIN",
    ]);

    const ownerPairs = (owner.body.routes as NetworkRoute[]).map((r) => `${r.aIata}-${r.bIata}`);
    expect(ownerPairs).not.toContain("JFK-SIN");
  });
});
