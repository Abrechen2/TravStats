import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /flights/entry-suggestions` — what the flight forms offer from the
 * user's own logbook. The two properties worth pinning: the ranking (count,
 * then recency, the route before the airline) and that nothing of another
 * account's logbook is ever offered.
 */
describe("GET /api/v1/flights/entry-suggestions", () => {
  let user: { id: string };
  let other: { id: string };
  let authCookie: string;

  const suggest = (query: Record<string, string> = {}) =>
    request(app).get("/api/v1/flights/entry-suggestions").query(query).set("Cookie", authCookie);

  type FlightData = Parameters<typeof prisma.flight.create>[0]["data"];
  const flight = (userId: string, over: Partial<FlightData>): FlightData => ({
    userId,
    depIata: "MUC",
    depIcao: "EDDM",
    depLat: 48.3538,
    depLon: 11.7861,
    arrIata: "CPH",
    arrLat: 55.6181,
    arrLon: 12.656,
    status: "flown",
    ...over,
  });

  beforeAll(async () => {
    const timestamp = Date.now();
    const make = (name: string) =>
      hashPassword("test-password").then((passwordHash) =>
        prisma.user.create({
          data: { username: `${name}-${timestamp}`, passwordHash, isAdmin: false, isActive: true },
        })
      );
    user = await make("entry-sugg");
    other = await make("entry-sugg-other");
    authCookie = `auth_token=${generateToken(user.id)}`;

    await prisma.flight.createMany({
      data: [
        // 12A twice (the older one lower-case), 3C once but most recent: the
        // merged count wins, and the later spelling is the one shown.
        flight(user.id, {
          airline: "Lufthansa",
          airlineIata: "LH",
          flightNumber: "LH2440",
          seatNumber: "12a",
          terminal: "2",
          frequentFlyerNumber: "992000111",
          departureTime: new Date("2023-01-01T08:00:00Z"),
        }),
        flight(user.id, {
          airline: "Lufthansa",
          airlineIata: "LH",
          flightNumber: "LH2440",
          seatNumber: "12A",
          terminal: "2",
          frequentFlyerNumber: "992000222",
          departureTime: new Date("2024-01-01T08:00:00Z"),
        }),
        // Operated by SAS but sold by Lufthansa — the marketing airline decides,
        // and this is the latest one, so its number is the one to offer.
        flight(user.id, {
          airline: "Lufthansa",
          airlineIata: "LH",
          operatingAirline: "SAS",
          operatingAirlineIata: "SK",
          flightNumber: "LH6000",
          arrIata: "ZRH",
          seatNumber: "3C",
          terminal: "1",
          frequentFlyerNumber: "992000333",
          departureTime: new Date("2025-01-01T08:00:00Z"),
        }),
        // Another airline on the same route: counts for the route, not LH.
        flight(user.id, {
          airline: "SAS",
          airlineIata: "SK",
          flightNumber: "SK1636",
          seatNumber: "",
          frequentFlyerNumber: "EB000999",
          departureTime: new Date("2025-06-01T08:00:00Z"),
        }),
        // Another account's logbook: nothing of it may surface.
        flight(other.id, {
          airline: "Lufthansa",
          airlineIata: "LH",
          flightNumber: "LH9999",
          seatNumber: "99K",
          terminal: "X",
          frequentFlyerNumber: "LEAKED",
          departureTime: new Date("2026-01-01T08:00:00Z"),
        }),
      ],
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [user?.id, other?.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [user?.id, other?.id] } } });
  });

  it("ranks seats by frequency, then recency, merging spellings and skipping blanks", async () => {
    const res = await suggest();
    expect(res.status).toBe(200);
    expect(res.body.seats).toEqual(["12A", "3C"]);
  });

  it("offers the route's flight numbers before the airline's", async () => {
    const res = await suggest({ airline: "SAS", dep: "MUC", arr: "CPH" });
    expect(res.status).toBe(200);
    expect(res.body.flightNumbers).toEqual(["LH2440", "SK1636"]);
  });

  it("offers the overall ranking when neither route nor airline is known", async () => {
    const res = await suggest();
    expect(res.body.flightNumbers).toEqual(["LH2440", "SK1636", "LH6000"]);
  });

  it("takes the frequent flyer number from the latest flight sold by the airline", async () => {
    const byCode = await suggest({ airline: "LH" });
    expect(byCode.body.frequentFlyerNumber).toBe("992000333");
    const byName = await suggest({ airline: "lufthansa" });
    expect(byName.body.frequentFlyerNumber).toBe("992000333");
  });

  it("abstains on the frequent flyer number without an airline or a match", async () => {
    expect((await suggest()).body.frequentFlyerNumber).toBeNull();
    expect((await suggest({ airline: "Condor" })).body.frequentFlyerNumber).toBeNull();
  });

  it("offers departure terminals only for the given airport, by IATA or ICAO", async () => {
    expect((await suggest({ dep: "MUC" })).body.departureTerminals).toEqual(["2", "1"]);
    expect((await suggest({ dep: "eddm" })).body.departureTerminals).toEqual(["2", "1"]);
    expect((await suggest({ dep: "FRA" })).body.departureTerminals).toEqual([]);
    expect((await suggest()).body.departureTerminals).toEqual([]);
  });

  it("never offers another account's data", async () => {
    const res = await suggest({ airline: "LH", dep: "MUC", arr: "CPH" });
    const text = JSON.stringify(res.body);
    for (const leaked of ["LH9999", "99K", "LEAKED", '"X"']) {
      expect(text).not.toContain(leaked);
    }
  });

  it("treats blank parameters as absent and rejects a malformed airport code", async () => {
    expect((await suggest({ airline: "", dep: "", arr: "" })).status).toBe(200);
    expect((await suggest({ dep: "MUNICH" })).status).toBe(400);
  });

  it("requires a session", async () => {
    const res = await request(app).get("/api/v1/flights/entry-suggestions");
    expect(res.status).toBe(401);
  });
});
