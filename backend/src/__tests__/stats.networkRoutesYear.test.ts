/**
 * Audit F-004 (2.7.0-rc.26). `/stats/network?year=2025` and
 * `/stats/routes?year=2025` ignored `year` and drew a 2026 flight, while
 * `/stats/summary?year=2025` correctly reported none. Both now place a flight
 * in a year by the same rule the summary uses — the local calendar day at the
 * departure airport (AUD-077, stats.yearIsLocalDeparture.test.ts).
 *
 * The Bangkok flight departs 01:30 local on 1 January 2025 but is stored as
 * 18:30Z on 31 December 2024, so a filter on the stored instant puts it in the
 * wrong year; the Frankfurt flight is the audit's plain 2026 case.
 */
import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

const USERNAME = "networkroutesyear";

describe("network and routes honour ?year= by local departure day", () => {
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
          userId: user.id,
          status: "flown",
          flightNumber: "TG920",
          depIata: "BKK",
          arrIata: "MUC",
          depLat: 13.6811,
          depLon: 100.7473,
          arrLat: 48.3538,
          arrLon: 11.7861,
          departureTime: new Date("2024-12-31T18:30:00Z"),
          arrivalTime: new Date("2025-01-01T02:30:00Z"),
        },
        {
          userId: user.id,
          status: "flown",
          flightNumber: "LH100",
          depIata: "FRA",
          arrIata: "MUC",
          depLat: 50.0333,
          depLon: 8.5706,
          arrLat: 48.3538,
          arrLon: 11.7861,
          departureTime: new Date("2026-03-10T08:00:00Z"),
          arrivalTime: new Date("2026-03-10T09:00:00Z"),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  const get = (path: string) => request(app).get(`/api/v1/stats/${path}`).set("Cookie", cookie);

  it("draws only the year's flights on the network", async () => {
    const res = await get("network?year=2025");
    expect(res.status).toBe(200);
    const pairs = (res.body.routes as { aIata: string; bIata: string }[]).map((r) =>
      [r.aIata, r.bIata].sort().join("-")
    );
    expect(pairs).toEqual(["BKK-MUC"]);
    const airports = (res.body.airports as { iata: string }[]).map((a) => a.iata).sort();
    expect(airports).toEqual(["BKK", "MUC"]);
  });

  it("ranks only the year's flights in routes", async () => {
    const res = await get("routes?year=2026");
    expect(res.status).toBe(200);
    expect((res.body.routes as { route: string }[]).map((r) => r.route)).toEqual(["FRA-MUC"]);
  });

  it("agrees with the summary about an empty year", async () => {
    const [summary, network, routes] = await Promise.all([
      get("summary?year=2024"),
      get("network?year=2024"),
      get("routes?year=2024"),
    ]);
    expect(summary.body.totalFlights).toBe(0);
    expect(network.body.routes).toEqual([]);
    expect(routes.body.routes).toEqual([]);
  });

  it("keeps the lifetime view without a year", async () => {
    const res = await get("network");
    expect(res.body.routes).toHaveLength(2);
  });

  it("refuses an unreadable year", async () => {
    expect((await get("network?year=abc")).status).toBe(400);
    expect((await get("routes?year=abc")).status).toBe(400);
  });
});
