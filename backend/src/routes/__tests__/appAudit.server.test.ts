import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { roadtripsCountTotal } from "../../services/stats/insights/roadtripsCount";
import { computeFerryStats } from "../../services/ferry/ferryStats";

/** Server side of the Companion audit (companion#85, companion#92). */
const stamp = Date.now();
let userId: string;
let cookie: string;

const end = (name: string, lat: number, lon: number, cc: string, tz: string) => ({
  name,
  lat,
  lon,
  cc,
  tz,
});
const SPLIT = end("Split", 43.5081, 16.4402, "HR", "Europe/Zagreb");
const ANCONA = end("Ancona", 43.6158, 13.5189, "IT", "Europe/Rome");

const ferry = (over: Record<string, unknown> = {}) =>
  prisma.ferryJourney.create({
    data: {
      userId,
      depStationName: SPLIT.name,
      depLat: SPLIT.lat,
      depLon: SPLIT.lon,
      depCountry: SPLIT.cc,
      depTimezone: SPLIT.tz,
      arrStationName: ANCONA.name,
      arrLat: ANCONA.lat,
      arrLon: ANCONA.lon,
      arrCountry: ANCONA.cc,
      arrTimezone: ANCONA.tz,
      departureTime: new Date("2025-07-01T18:00Z"),
      arrivalTime: new Date("2025-07-02T07:00Z"),
      depPrecision: "minute",
      arrPrecision: "minute",
      status: "completed",
      ...over,
    } as never,
  });

beforeAll(async () => {
  const passwordHash = await hashPassword("test-password");
  userId = (await prisma.user.create({ data: { username: `app-audit-${stamp}`, passwordHash } }))
    .id;
  cookie = `auth_token=${generateToken(userId)}`;
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
});

describe("GET /ferry/stats", () => {
  it("answers null, never 0, for distance and hours when no crossing carries them", async () => {
    await ferry({ distanceKm: null, arrivalTime: null, arrPrecision: null });
    const res = await request(app).get("/api/v1/ferry/stats").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.crossings).toBe(1);
    expect(res.body.data.distance.totalKm).toBeNull();
    expect(res.body.data.distance.unmeasuredCrossings).toBe(1);
    expect(res.body.data.hoursOnBoard).toEqual({ hours: null, measuredCrossings: 0 });
    expect(res.body.data.byYear[0].km).toBeNull();
  });

  it("counts completed crossings only, sums per source and filters by year", async () => {
    await ferry({ distanceKm: 200, distanceSource: "route", operator: "Jadrolinija" });
    await ferry({
      distanceKm: 999,
      status: "cancelled",
      departureTime: new Date("2025-08-01T18:00Z"),
    });
    await ferry({
      distanceKm: 50,
      distanceSource: "user",
      operator: " jadrolinija ",
      departureTime: new Date("2024-05-01T10:00Z"),
      arrivalTime: null,
      arrPrecision: null,
    });
    const all = (await request(app).get("/api/v1/ferry/stats").set("Cookie", cookie)).body.data;
    expect(all.crossings).toBe(3);
    expect(all.distance).toMatchObject({ totalKm: 250, routeKm: 200, ticketKm: 50 });
    expect(all.distance.straightLineKm).toBeNull();
    expect(all.operators).toEqual([{ label: "jadrolinija", count: 2 }]);
    expect(all.countries).toEqual(["HR", "IT"]);
    const y = (await request(app).get("/api/v1/ferry/stats?year=2024").set("Cookie", cookie)).body
      .data;
    expect(y.crossings).toBe(1);
    expect(y.hoursOnBoard.hours).toBeNull();
    const bad = await request(app).get("/api/v1/ferry/stats?until=07-01").set("Cookie", cookie);
    expect(bad.status).toBe(400);
  });

  it("computeFerryStats of nothing is zero crossings and null figures", () => {
    const s = computeFerryStats([]);
    expect(s.crossings).toBe(0);
    expect(s.distance.totalKm).toBeNull();
    expect(s.longest).toBeNull();
    expect(s.hoursOnBoard.hours).toBeNull();
  });
});

describe("GET /trips/:id distance", () => {
  it("is null in total and per mode for a trip with no measured leg", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Empty" } });
    const res = await request(app).get(`/api/v1/trips/${trip.id}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.trip.totalDistanceKm).toBeNull();
    expect(res.body.trip.distanceByMode).toEqual({
      flight: null,
      rail: null,
      bus: null,
      ferry: null,
      cruise: null,
      roadtrip: null,
    });
  });

  it("sums each mode over the legs its counting rule counts, null where it has none", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Mixed" } });
    await ferry({ tripId: trip.id, distanceKm: 200.4 });
    // A cancelled ferry and a planned one count in no figure.
    await ferry({ tripId: trip.id, distanceKm: 900, status: "cancelled" });
    await prisma.railJourney.create({
      data: {
        userId,
        tripId: trip.id,
        depStationName: "A",
        depLat: 1,
        depLon: 1,
        arrStationName: "B",
        arrLat: 2,
        arrLon: 2,
        departureTime: new Date("2025-01-01T08:00Z"),
        status: "completed",
        distanceKm: 100,
      } as never,
    });
    // A kept tram ride proves no rail figure (owner rule, railCounting).
    await prisma.railJourney.create({
      data: {
        userId,
        tripId: trip.id,
        transitMode: "tram",
        depStationName: "A",
        depLat: 1,
        depLon: 1,
        arrStationName: "B",
        arrLat: 2,
        arrLon: 2,
        departureTime: new Date("2025-01-02T08:00Z"),
        status: "completed",
        distanceKm: 700,
      } as never,
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId: trip.id,
        depIata: "FRA",
        arrIata: "LHR",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 51.47,
        arrLon: -0.4543,
        departureTime: new Date("2025-02-01T08:00Z"),
        status: "flown",
      } as never,
    });
    const res = await request(app).get(`/api/v1/trips/${trip.id}`).set("Cookie", cookie);
    const { distanceByMode: by, totalDistanceKm: total } = res.body.trip;
    expect(by.ferry).toBe(200);
    expect(by.rail).toBe(100);
    expect(by.flight).toBeGreaterThan(600);
    expect(by.flight).toBeLessThan(700);
    expect(by.bus).toBeNull();
    expect(by.cruise).toBeNull();
    expect(by.roadtrip).toBeNull();
    expect(total).toBe(by.flight + 200 + 100);
  });
});

describe("trip countries from place visits", () => {
  it("adds the country of a visited place visit and skips wishlist, future and transit places", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Places" } });
    const place = (name: string, over: Record<string, unknown>) =>
      prisma.place.create({
        data: { userId, name, lat: 1, lon: 1, ...over } as never,
      });
    const visit = (placeId: string, visitedAt: Date | null) =>
      prisma.placeVisit.create({
        data: {
          user: { connect: { id: userId } },
          place: { connect: { id: placeId } },
          trip: { connect: { id: trip.id } },
          visitedAt,
        },
      });

    const real = await place("Lisbon Castle", { visited: true, isoCountryCode: "PT" });
    await visit(real.id, new Date("2024-03-01T10:00:00Z"));
    const undated = await place("Porto Cafe", { visited: true, isoCountryCode: "PT" });
    await visit(undated.id, null);
    const wish = await place("Wishlist Rome", { visited: false, isoCountryCode: "IT" });
    await visit(wish.id, new Date("2024-03-01T10:00:00Z"));
    const future = await place("Future Madrid", { visited: true, isoCountryCode: "ES" });
    await visit(future.id, new Date("2099-01-01T10:00:00Z"));
    const transit = await place("Service Area", {
      visited: true,
      isoCountryCode: "FR",
      countryVisitKind: "transit",
    });
    await visit(transit.id, new Date("2024-03-02T10:00:00Z"));

    const detail = await request(app).get(`/api/v1/trips/${trip.id}`).set("Cookie", cookie);
    expect(detail.body.trip.countries).toEqual(["PT"]);
    const list = await request(app).get("/api/v1/trips").set("Cookie", cookie);
    const listed = list.body.trips.find((t: { id: string }) => t.id === trip.id);
    expect(listed.countries).toEqual(["PT"]);
  });
});

describe("roadtripsCount in the roadtrip insights totals", () => {
  const at = new Date("2026-06-01T00:00:00Z");

  it("counts started roadtrips by their start year and keeps undated ones out of every year", () => {
    const total = roadtripsCountTotal(
      [
        { startDate: "2025-05-01T00:00:00.000Z" },
        { startDate: "2025-09-01T00:00:00.000Z" },
        { startDate: "2024-01-01T00:00:00.000Z" },
        { startDate: "2099-01-01T00:00:00.000Z" },
        { startDate: null },
      ],
      at
    );
    expect(total).toEqual({ allTime: 4, byYear: { "2024": 1, "2025": 2 } });
  });

  it("is 0 allTime with no byYear key for a user without roadtrips, over HTTP", async () => {
    const res = await request(app).get("/api/v1/stats/insights/roadtrips").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.totals.roadtripsCount).toEqual({ allTime: 0, byYear: {} });
  });
});
