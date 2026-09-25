import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { loadCrossDomainPopulation } from "../../services/evidence/crossDomainPopulations";

/**
 * GET /rail/stats (spec 2026-09-25-rail-domain, phase 2b): figures over the
 * COMPLETED rides only, kilometres per source, and abstention wherever a ride
 * carries no figure — plus the same rides in the cross-domain evidence.
 */
describe("rail statistics", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;

  const base = {
    depLat: 50.1,
    depLon: 8.66,
    arrLat: 47.55,
    arrLon: 7.59,
    depTimezone: "Europe/Berlin",
    arrTimezone: "Europe/Zurich",
  };

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `rail-stats-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.railJourney.createMany({
      data: [
        {
          ...base,
          userId,
          status: "completed",
          operator: "DB Fernverkehr",
          trainCategory: "ICE",
          depStationName: "Frankfurt (Main) Hbf",
          depStationCode: "8011068",
          arrStationName: "Basel SBB",
          depCountry: "DE",
          arrCountry: "CH",
          departureTime: new Date("2025-03-01T07:00:00Z"),
          arrivalTime: new Date("2025-03-01T10:00:00Z"),
          distanceKm: 330,
          distanceSource: "great_circle",
          delayMinutes: 12,
        },
        {
          ...base,
          userId,
          status: "completed",
          operator: "DB Fernverkehr",
          trainCategory: "ICE",
          depStationName: "Frankfurt (Main) Hbf",
          depStationCode: "8011068",
          arrStationName: "Berlin Hbf",
          arrTimezone: "Europe/Berlin",
          depCountry: "DE",
          arrCountry: "DE",
          departureTime: new Date("2025-06-01T06:00:00Z"),
          arrivalTime: new Date("2025-06-01T10:00:00Z"),
          distanceKm: 547,
          distanceSource: "route",
          delayMinutes: 0,
        },
        {
          // A night train leaving Vienna on New Year's Eve: a 2024 ride.
          ...base,
          userId,
          status: "completed",
          operator: "ÖBB",
          trainCategory: "NJ",
          depStationName: "Wien Hbf",
          arrStationName: "Zürich HB",
          depTimezone: "Europe/Vienna",
          depCountry: "AT",
          arrCountry: "CH",
          departureTime: new Date("2024-12-31T21:58:00Z"),
          arrivalTime: new Date("2025-01-01T07:20:00Z"),
          distanceKm: null,
          distanceSource: null,
          delayMinutes: null,
        },
        {
          ...base,
          userId,
          status: "scheduled",
          depStationName: "Future",
          arrStationName: "Ride",
          departureTime: new Date("2099-01-01T07:00:00Z"),
          distanceKm: 999,
          distanceSource: "great_circle",
        },
        {
          ...base,
          userId,
          status: "cancelled",
          depStationName: "Never",
          arrStationName: "Ran",
          departureTime: new Date("2025-02-01T07:00:00Z"),
          distanceKm: 999,
          distanceSource: "user",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const get = (query = "") => request(app).get(`/api/v1/rail/stats${query}`).set("Cookie", cookie);

  it("counts completed rides only, and reports kilometres per source", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.journeys).toBe(3);
    expect(s.distance).toEqual({
      totalKm: 877,
      straightLineKm: 330,
      tracedKm: 547,
      ticketKm: 0,
      unmeasuredJourneys: 1,
    });
    expect(s.longest).toMatchObject({ arrStationName: "Berlin Hbf", distanceSource: "route" });
  });

  it("keeps a ride without a figure out of that figure's sample", async () => {
    const s = (await get()).body.data;
    expect(s.hoursOnBoard.measuredJourneys).toBe(3);
    expect(s.delays.recordedJourneys).toBe(2);
    // 0 is on time; 12 falls in the (5, 15] bucket.
    expect(s.delays.buckets[0]).toEqual({ upToMinutes: 0, count: 1 });
    expect(s.delays.buckets[2]).toEqual({ upToMinutes: 15, count: 1 });
  });

  it("ranks operators, categories and stations, and lists both stations' countries", async () => {
    const s = (await get()).body.data;
    expect(s.operators[0]).toEqual({ label: "DB Fernverkehr", count: 2 });
    expect(s.trainCategories.map((r: { label: string }) => r.label)).toEqual(["ICE", "NJ"]);
    expect(s.stations[0]).toEqual({ label: "Frankfurt (Main) Hbf", count: 2 });
    expect(s.countries).toEqual(["AT", "CH", "DE"]);
  });

  it("files a night train under the year it left, on its station's calendar", async () => {
    const y2024 = (await get("?year=2024")).body.data;
    expect(y2024.journeys).toBe(1);
    expect(y2024.operators[0].label).toBe("ÖBB");
    expect((await get("?year=2025")).body.data.journeys).toBe(2);
  });

  it("brings the same rides into the cross-domain evidence", async () => {
    const population = await loadCrossDomainPopulation(userId, ["rail"]);
    expect(population.events).toHaveLength(3);
    const night = population.events.find((e) => e.entry.title.text === "Wien Hbf → Zürich HB");
    expect(night).toMatchObject({ year: 2024, dayKeys: ["2024-12-31", "2025-01-01"] });
    expect(night?.entry.href).toMatch(/^\/rail\//);
    expect(new Set(population.countryRows.flatMap((r) => r.countries))).toEqual(
      new Set(["AT", "CH", "DE"])
    );
  });

  it("refuses a nonsense year", async () => {
    expect((await get("?year=abc")).status).toBe(400);
  });
});
