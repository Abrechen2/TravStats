import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The tab strip's "next up" line. What matters here is not that each query
 * works — it is that all four agree on ONE definition of "next": a date in
 * the future, cancelled rows excluded, and nothing from a domain the user has
 * switched off.
 */
const DAY = 86_400_000;
const inDays = (n: number): Date => new Date(Date.now() + n * DAY);
/** Coordinates are NOT NULL on Flight; the values are irrelevant to this route. */
const COORDS = { depLat: 48.35, depLon: 11.79, arrLat: 48.11, arrLon: 16.57 };

describe("GET /api/v1/upcoming", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "upcomingtest" } });
    const user = await prisma.user.create({
      data: { username: "upcomingtest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const enableDomains = async (domains: string[]): Promise<void> => {
    await prisma.userSettings.upsert({
      where: { userId },
      update: { enabledDomains: domains },
      // `data` is a required Json blob on this model — the settings row holds
      // its free-form preferences there alongside the typed columns.
      create: { userId, enabledDomains: domains, data: {} },
    });
  };

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/upcoming");
    expect(res.status).toBe(401);
  });

  it("returns the soonest future flight, and never one that has already left", async () => {
    await enableDomains(["flight"]);
    await prisma.flight.createMany({
      data: [
        { userId, flightNumber: "PAST", depIata: "MUC", arrIata: "JFK", ...COORDS, departureTime: inDays(-3) },
        { userId, flightNumber: "SOON", depIata: "MUC", arrIata: "VIE", ...COORDS, departureTime: inDays(2) },
        { userId, flightNumber: "LATER", depIata: "MUC", arrIata: "LHR", ...COORDS, departureTime: inDays(9) },
      ],
    });

    const res = await request(app).get("/api/v1/upcoming").set("Cookie", authCookie);

    expect(res.status).toBe(200);
    const flight = res.body.data.entries.find((e: { domain: string }) => e.domain === "flight");
    expect(flight.secondary).toContain("SOON");
  });

  it("does not repeat the carrier when the flight number already carries it", async () => {
    // "LH" + "LH2280" read "LH LH2280" in the strip — measured in the browser.
    await enableDomains(["flight"]);
    await prisma.flight.create({
      data: {
        userId,
        airlineIata: "LH",
        flightNumber: "LH2280",
        depIata: "MUC",
        arrIata: "VIE",
        ...COORDS,
        departureTime: inDays(2),
      },
    });

    const res = await request(app).get("/api/v1/upcoming").set("Cookie", authCookie);

    const flight = res.body.data.entries.find((e: { domain: string }) => e.domain === "flight");
    expect(flight.secondary).toBe("LH2280");
  });

  it("still prepends the carrier when the number stands alone", async () => {
    await enableDomains(["flight"]);
    await prisma.flight.create({
      data: {
        userId,
        airlineIata: "OS",
        flightNumber: "112",
        depIata: "MUC",
        arrIata: "VIE",
        ...COORDS,
        departureTime: inDays(2),
      },
    });

    const res = await request(app).get("/api/v1/upcoming").set("Cookie", authCookie);

    const flight = res.body.data.entries.find((e: { domain: string }) => e.domain === "flight");
    expect(flight.secondary).toBe("OS 112");
  });

  it("ignores a cancelled flight even when it is the soonest", async () => {
    await enableDomains(["flight"]);
    await prisma.flight.createMany({
      data: [
        {
          userId,
          flightNumber: "OFF",
          depIata: "MUC",
          arrIata: "VIE",
          ...COORDS,
          departureTime: inDays(1),
          status: "cancelled",
        },
        { userId, flightNumber: "ON", depIata: "MUC", arrIata: "LHR", ...COORDS, departureTime: inDays(5) },
      ],
    });

    const res = await request(app).get("/api/v1/upcoming").set("Cookie", authCookie);

    const flight = res.body.data.entries.find((e: { domain: string }) => e.domain === "flight");
    expect(flight.secondary).toContain("ON");
  });

  it("says nothing about a domain the user has switched off", async () => {
    // The gating lives on the SERVER so a client cannot forget it — the same
    // rule every other domain-aware surface follows.
    await enableDomains(["cruise"]);
    await prisma.flight.create({
      data: { userId, flightNumber: "HIDDEN", depIata: "MUC", arrIata: "VIE", ...COORDS, departureTime: inDays(1) },
    });

    const res = await request(app).get("/api/v1/upcoming").set("Cookie", authCookie);

    expect(res.body.data.entries.some((e: { domain: string }) => e.domain === "flight")).toBe(false);
  });

  it("sorts what it found soonest first, across domains", async () => {
    await enableDomains(["flight"]);
    await prisma.trip.create({
      data: { userId, name: "Tokyo", startDate: inDays(1) },
    });
    await prisma.flight.create({
      data: { userId, flightNumber: "LH1", depIata: "MUC", arrIata: "VIE", ...COORDS, departureTime: inDays(4) },
    });

    const res = await request(app).get("/api/v1/upcoming").set("Cookie", authCookie);

    expect(res.body.data.entries.map((e: { domain: string }) => e.domain)).toEqual([
      "trip",
      "flight",
    ]);
  });

  it("names the trip an entry belongs to", async () => {
    await enableDomains(["flight"]);
    const trip = await prisma.trip.create({
      data: { userId, name: "Tokyo · Japan", startDate: inDays(30) },
    });
    await prisma.flight.create({
      data: {
        userId,
        flightNumber: "LH2280",
        depIata: "MUC",
        arrIata: "VIE",
        ...COORDS,
        departureTime: inDays(2),
        tripId: trip.id,
      },
    });

    const res = await request(app).get("/api/v1/upcoming").set("Cookie", authCookie);

    const flight = res.body.data.entries.find((e: { domain: string }) => e.domain === "flight");
    expect(flight.tripName).toBe("Tokyo · Japan");
    expect(flight.tripId).toBe(trip.id);
  });

  it("leaves tripName empty on the trip entry itself", async () => {
    await enableDomains(["flight"]);
    await prisma.trip.create({ data: { userId, name: "Solo", startDate: inDays(3) } });

    const res = await request(app).get("/api/v1/upcoming").set("Cookie", authCookie);

    const trip = res.body.data.entries.find((e: { domain: string }) => e.domain === "trip");
    expect(trip.primary).toBe("Solo");
    expect(trip.tripName).toBeNull();
  });

  it("returns an empty list when nothing lies ahead", async () => {
    await enableDomains(["flight", "cruise", "lodging"]);
    await prisma.flight.create({
      data: { userId, flightNumber: "OLD", depIata: "MUC", arrIata: "VIE", ...COORDS, departureTime: inDays(-9) },
    });

    const res = await request(app).get("/api/v1/upcoming").set("Cookie", authCookie);

    expect(res.body.data.entries).toEqual([]);
  });
});
