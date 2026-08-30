import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Covers the depCountry/arrCountry/depTimezone/arrTimezone fields added to
 * the GET /api/v1/flights list response. Resolved from the same
 * getCachedAirports() batch the handler already uses for duration
 * calculation — zero extra queries.
 */
describe("GET /api/v1/flights — country + timezone enrichment", () => {
  let user: { id: string };
  let authCookie: string;
  let seededFlightId: string;
  let catalogReady = false;

  beforeAll(async () => {
    const [muc, jfk] = await Promise.all([
      prisma.airport.findFirst({ where: { iata: "MUC" } }),
      prisma.airport.findFirst({ where: { iata: "JFK" } }),
    ]);
    catalogReady = Boolean(muc && jfk);
    if (!catalogReady) {
      // eslint-disable-next-line no-console
      console.warn(
        "SKIP: airports catalog is empty in the dev DB (MUC/JFK not found) — run the airport seed before running this test.",
      );
      return;
    }

    const timestamp = Date.now();
    user = await prisma.user.create({
      data: {
        username: `flights-list-enrichment-test-${timestamp}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;

    const flight = await prisma.flight.create({
      data: {
        userId: user.id,
        depIata: "MUC",
        depLat: 48.3538,
        depLon: 11.7861,
        arrIata: "JFK",
        arrLat: 40.6413,
        arrLon: -73.7781,
        status: "flown",
      },
    });
    seededFlightId = flight.id;
  });

  afterAll(async () => {
    if (!catalogReady) return;
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it("returns dep/arr country and timezone resolved from the airports catalog", async () => {
    if (!catalogReady) return;
    const res = await request(app).get("/api/v1/flights?limit=5").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    const flight = res.body.flights.find((f: { id: string }) => f.id === seededFlightId);
    expect(flight).toBeDefined();
    expect(flight.depCountry).toBe("DE");
    expect(flight.arrCountry).toBe("US");
    expect(typeof flight.depTimezone).toBe("string");
    expect(typeof flight.arrTimezone).toBe("string");
  });

  /**
   * The single-flight endpoint feeds the flight DETAIL page, and the detail
   * page renders each end in its airport's clock using exactly the fields
   * below. When only the list enriched them, the detail page fell back to UTC
   * and a Munich departure of 12:16 read "10:16 UTC" on its own page while the
   * list and the trip timeline both said 12:16.
   *
   * This asserts the two endpoints AGREE rather than restating what the values
   * should be — a copy of the rule would pass while the surfaces drifted apart.
   */
  it("gives the single-flight endpoint the same enrichment as the list", async () => {
    if (!catalogReady) return;
    const [listRes, oneRes] = await Promise.all([
      request(app).get("/api/v1/flights?limit=200").set("Cookie", authCookie),
      request(app).get(`/api/v1/flights/${seededFlightId}`).set("Cookie", authCookie),
    ]);
    expect(listRes.status).toBe(200);
    expect(oneRes.status).toBe(200);

    const fromList = listRes.body.flights.find(
      (f: { id: string }) => f.id === seededFlightId,
    );
    expect(fromList).toBeDefined();

    for (const field of [
      "depTimezone",
      "arrTimezone",
      "depCountry",
      "arrCountry",
      "durationMinutes",
    ] as const) {
      expect({ [field]: oneRes.body[field] }).toEqual({ [field]: fromList[field] });
    }
  });
});
