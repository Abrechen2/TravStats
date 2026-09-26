import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import {
  computeTripSuggestions,
  invalidateTripSuggestions,
} from "../../services/tripSuggestions/engine";

/**
 * Acceptance D10 (2026-09-26): a proposed trip to Barcelona was named
 * "Josep Tarradellas Barcelona-El Prat" — the two flight ends outvoted the
 * hotel's "Barcelona" with the airport's name. Against the seeded catalogue.
 */
describe("a trip suggestion's name", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `ts-dest-${Date.now()}`, passwordHash: await hashPassword("pw-123456") },
    });
    userId = user.id;
    await prisma.userSettings.create({
      data: {
        userId,
        enabledDomains: ["flight", "lodging"],
        data: { homeAirportHistory: [{ iata: "MUC", fromDate: "2000-01-01", toDate: null }] },
      },
    });
    const muc = { lat: 48.3538, lon: 11.7861 };
    const bcn = { lat: 41.2971, lon: 2.0785 };
    const flight = (dep: string, arr: string, from: typeof muc, to: typeof muc, at: string) =>
      prisma.flight.create({
        data: {
          userId,
          depIata: dep,
          arrIata: arr,
          depLat: from.lat,
          depLon: from.lon,
          arrLat: to.lat,
          arrLon: to.lon,
          departureTime: new Date(at),
          status: "flown",
        },
      });
    await flight("MUC", "BCN", muc, bcn, "2025-04-10T07:00:00Z");
    await flight("BCN", "MUC", bcn, muc, "2025-04-13T17:00:00Z");
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Arts", city: "Barcelona", lat: 41.3868, lon: 2.1966 },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2025-04-10T00:00:00Z"),
        checkOut: new Date("2025-04-13T00:00:00Z"),
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("names the city the airport serves, not the airport", async () => {
    invalidateTripSuggestions(userId);
    const { suggestions } = await computeTripSuggestions(userId);
    const [trip] = suggestions.filter((s) => s.kind === "new_trip");
    expect(trip?.destination).toBe("Barcelona");
  });
});
