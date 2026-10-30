import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as achievements from "../../utils/achievements";

/**
 * forgejo#385 (RULE-28): deleting a flight or a cruise recomputed neither its
 * trip's status nor the achievements, while rail, bus, ferry and rental did —
 * a trip kept "ongoing/planned" for a leg that no longer existed.
 */
describe("deleting a flight or cruise re-derives the trip and the badges", () => {
  let userId: string;
  let cookie: string;
  let recheck: jest.SpyInstance;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "deleteRestatus" } });
    const u = await prisma.user.create({
      data: { username: "deleteRestatus", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    recheck = jest.spyOn(achievements, "recheckAchievements");
  });
  afterAll(async () => {
    recheck.mockRestore();
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  beforeEach(() => recheck.mockClear());

  const flight = (tripId: string, departure: string, arrival: string) =>
    prisma.flight.create({
      data: {
        userId,
        tripId,
        depLat: 50,
        depLon: 8,
        arrLat: 51,
        arrLon: 0,
        depIata: "FRA",
        arrIata: "LHR",
        departureTime: new Date(departure),
        arrivalTime: new Date(arrival),
        status: "scheduled",
      },
    });

  it("a deleted flight leaves its trip with the status of the flights that remain", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "T", status: "planned" } });
    await flight(trip.id, "2024-03-01T08:00:00Z", "2024-03-01T10:00:00Z");
    const future = await flight(trip.id, "2099-03-10T08:00:00Z", "2099-03-10T10:00:00Z");

    const res = await request(app).delete(`/api/v1/flights/${future.id}`).set("Cookie", cookie);
    expect(res.status).toBe(204);

    const after = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(after.status).toBe("completed");
    expect(recheck).toHaveBeenCalledWith(userId, "flight delete");
  });

  it("a deleted cruise leaves its trip with the status of what remains", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "C", status: "planned" } });
    await flight(trip.id, "2024-03-01T08:00:00Z", "2024-03-01T10:00:00Z");
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        tripId: trip.id,
        cruiseLine: "Future Line",
        startDate: new Date("2099-06-01T00:00:00Z"),
        endDate: new Date("2099-06-08T00:00:00Z"),
      },
    });

    const res = await request(app).delete(`/api/v1/cruises/${cruise.id}`).set("Cookie", cookie);
    expect(res.status).toBe(204);

    const after = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(after.status).toBe("completed");
    expect(recheck).toHaveBeenCalledWith(userId, "cruise delete");
  });
});
