import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#132 items 19 and 21 on `GET /flights/entry-suggestions`: every
 * ranked chip says how often it was used (the "3×" of design 29n), and the
 * form gets the user's own airlines and aircraft, ranked like the rest. The
 * existing string lists stay exactly as they were — the Companion reads them.
 */
describe("flight entry suggestions: usage counts, airlines and aircraft", () => {
  let userId: string;
  let otherId: string;
  let cookie: string;

  const suggest = (query: Record<string, string> = {}) =>
    request(app).get("/api/v1/flights/entry-suggestions").query(query).set("Cookie", cookie);

  type FlightData = Parameters<typeof prisma.flight.create>[0]["data"];
  const flight = (owner: string, over: Partial<FlightData>): FlightData => ({
    userId: owner,
    depIata: "MUC",
    depLat: 48.3538,
    depLon: 11.7861,
    arrIata: "CPH",
    arrLat: 55.6181,
    arrLon: 12.656,
    status: "flown",
    ...over,
  });

  beforeAll(async () => {
    const stamp = Date.now();
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `es-usage-${stamp}`, passwordHash } }))
      .id;
    otherId = (
      await prisma.user.create({ data: { username: `es-usage-o-${stamp}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    const lh = { airline: "Lufthansa", airlineIata: "LH" };
    await prisma.flight.createMany({
      data: [
        flight(userId, {
          ...lh,
          flightNumber: "LH2440",
          seatNumber: "12a",
          aircraft: "a320",
          departureTime: new Date("2023-01-01T08:00:00Z"),
        }),
        flight(userId, {
          ...lh,
          flightNumber: "LH2440",
          seatNumber: "12A",
          aircraft: "A320",
          departureTime: new Date("2024-01-01T08:00:00Z"),
        }),
        flight(userId, {
          airline: "lufthansa",
          airlineIata: "LH",
          flightNumber: "LH2442",
          seatNumber: "3C",
          aircraft: "A321neo",
          departureTime: new Date("2025-01-01T08:00:00Z"),
        }),
        flight(userId, {
          airline: "SAS",
          airlineIata: "SK",
          flightNumber: "SK1636",
          aircraft: "CRJ900",
          departureTime: new Date("2025-06-01T08:00:00Z"),
        }),
        flight(userId, {
          airline: "",
          flightNumber: "XX1",
          departureTime: new Date("2025-07-01T08:00:00Z"),
        }),
        flight(otherId, {
          airline: "Condor",
          airlineIata: "DE",
          aircraft: "B767",
          flightNumber: "DE1",
          departureTime: new Date("2026-01-01T08:00:00Z"),
        }),
      ],
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });

  it("counts each seat, flight number and terminal it offers, in the lists' own order", async () => {
    const res = await suggest({ dep: "MUC", arr: "CPH" });
    expect(res.status).toBe(200);
    expect(res.body.seats).toEqual(["12A", "3C"]);
    expect(res.body.usage.seats).toEqual([
      { value: "12A", usageCount: 2 },
      { value: "3C", usageCount: 1 },
    ]);
    expect(res.body.usage.flightNumbers.map((u: { value: string }) => u.value)).toEqual(
      res.body.flightNumbers
    );
    expect(res.body.usage.flightNumbers[0]).toEqual({ value: "LH2440", usageCount: 2 });
    expect(res.body.usage.departureTerminals).toEqual([]);
  });

  it("offers the user's own airlines, spellings merged, most flown first", async () => {
    const res = await suggest();
    expect(res.body.airlines).toEqual([
      { name: "Lufthansa", iata: "LH", icao: null, usageCount: 3 },
      { name: "SAS", iata: "SK", icao: null, usageCount: 1 },
    ]);
  });

  it("offers aircraft flown with the airline first, then the rest of the logbook", async () => {
    expect((await suggest()).body.aircraft).toEqual([
      { value: "A320", usageCount: 2 },
      { value: "CRJ900", usageCount: 1 },
      { value: "A321neo", usageCount: 1 },
    ]);
    expect((await suggest({ airline: "SK" })).body.aircraft).toEqual([
      { value: "CRJ900", usageCount: 1 },
      { value: "A320", usageCount: 2 },
      { value: "A321neo", usageCount: 1 },
    ]);
  });

  it("never offers another account's airline or aircraft", async () => {
    const text = JSON.stringify((await suggest()).body);
    expect(text).not.toContain("Condor");
    expect(text).not.toContain("B767");
  });
});
