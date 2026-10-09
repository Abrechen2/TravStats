import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * GET /bus/stats (spec 2026-10-07 §6, B2; forgejo#263): completed rides only,
 * km per source, hours and delays over the rides that carry them, journeys
 * only through a shared booking, night buses by the clock.
 */
const HAMBURG = { name: "Hamburg ZOB", lat: 53.5527, lon: 10.0102, tz: "Europe/Berlin", cc: "DE" };
const BERLIN = { name: "Berlin ZOB", lat: 52.5073, lon: 13.2797, tz: "Europe/Berlin", cc: "DE" };
const PRAHA = { name: "Praha Florenc", lat: 50.0897, lon: 14.4397, tz: "Europe/Prague", cc: "CZ" };
type Stop = typeof HAMBURG;
type Ride = Parameters<typeof prisma.busJourney.create>[0]["data"];

describe("bus statistics", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;

  const add = (from: Stop, to: Stop, dep: string, arr: string | null, over: Partial<Ride> = {}) =>
    prisma.busJourney.create({
      data: {
        userId,
        depStationName: from.name,
        depLat: from.lat,
        depLon: from.lon,
        depTimezone: from.tz,
        depCountry: from.cc,
        arrStationName: to.name,
        arrLat: to.lat,
        arrLon: to.lon,
        arrTimezone: to.tz,
        arrCountry: to.cc,
        departureTime: new Date(dep),
        arrivalTime: arr ? new Date(arr) : null,
        depPrecision: "minute",
        arrPrecision: arr ? "minute" : null,
        status: "completed",
        ...over,
      } as Ride,
    });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `bus-stats-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    const booking = await prisma.booking.create({ data: { userId } });
    // 2024: Hamburg → Berlin, straight line, 10 min late.
    await add(HAMBURG, BERLIN, "2024-04-01T07:00Z", "2024-04-01T10:15Z", {
      operator: "FlixBus",
      rideKind: "intercity",
      distanceKm: 255,
      distanceSource: "great_circle",
      delayMinutes: 10,
    });
    // 2025: Hamburg → Berlin → Praha on one booking, the second leg overnight.
    await add(HAMBURG, BERLIN, "2025-06-01T13:00Z", "2025-06-01T16:15Z", {
      operator: "flixbus",
      bookingId: booking.id,
      distanceKm: 290,
      distanceSource: "route",
    });
    await add(BERLIN, PRAHA, "2025-06-01T17:00Z", "2025-06-02T00:00Z", {
      operator: "FlixBus",
      bookingId: booking.id,
      distanceKm: null,
    });
    // A date-only ride: no hours, no delay, no night.
    await add(PRAHA, BERLIN, "2025-06-10T00:00Z", "2025-06-11T00:00Z", {
      depPrecision: "day",
      arrPrecision: "day",
      delayMinutes: 45,
      distanceKm: 280,
      distanceSource: "user",
    });
    // Never counted.
    await add(BERLIN, HAMBURG, "2025-07-01T08:00Z", "2025-07-01T11:00Z", { status: "cancelled" });
    await add(BERLIN, HAMBURG, "2099-07-01T08:00Z", "2099-07-01T11:00Z", { status: "scheduled" });
  });

  afterAll(async () => {
    await prisma.busJourney.deleteMany({ where: { userId } });
    await prisma.booking.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const get = (query = "") => request(app).get(`/api/v1/bus/stats${query}`).set("Cookie", cookie);

  it("counts completed rides only, kilometres per source, and abstains where a ride says nothing", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.rides).toBe(4);
    expect(s.distance).toEqual({
      totalKm: 825,
      straightLineKm: 255,
      routeKm: 290,
      ticketKm: 280,
      unmeasuredRides: 1,
    });
    // Hours: three rides with both clocks; the date-only one is out.
    expect(s.hoursOnBoard.measuredRides).toBe(3);
    // Delays: the date-only ride's 45 minutes are no measurement.
    expect(s.delays.recordedRides).toBe(1);
    expect(s.delays.averageMinutes).toBe(10);
    expect(s.operators).toEqual([{ label: "FlixBus", count: 3 }]);
    expect(s.countries).toEqual(["CZ", "DE"]);
    expect(s.rideKinds).toEqual([
      { label: "unknown", count: 3 },
      { label: "intercity", count: 1 },
    ]);
  });

  it("reads a change on one booking as one journey, and a ride overnight as a night bus", async () => {
    const s = (await get()).body.data;
    expect(s.journeys).toEqual({ total: 3, withTransfer: 1 });
    expect(s.transfers).toEqual({ count: 1, averageMinutes: 45 });
    expect(s.night).toEqual({ rides: 1, nights: 1 });
    // Both directions together: Praha and back is one connection taken twice.
    expect(s.favouriteConnections).toEqual([
      expect.objectContaining({ from: "Berlin ZOB", to: "Hamburg ZOB", rides: 2 }),
      expect.objectContaining({ from: "Berlin ZOB", to: "Praha Florenc", rides: 2 }),
    ]);
  });

  it("files terminals, new destinations and returns by the rides' own calendars", async () => {
    const all = (await get()).body.data;
    expect(all.terminalsVisited).toBe(3);
    // Berlin in 2024, Praha in 2025; Hamburg was only ever left from.
    expect(all.newDestinations.byYear).toEqual([
      { year: 2024, count: 1 },
      { year: 2025, count: 1 },
    ]);
    expect(all.longestReturn).toEqual({ days: 426, terminal: "Hamburg ZOB" });
    const y2025 = (await get("?year=2025")).body.data;
    expect(y2025.rides).toBe(3);
    expect(y2025.newDestinations.inScope).toBe(1);
  });

  it("cuts a running year at a month-day and refuses `until` without a year", async () => {
    expect((await get("?year=2025&until=06-05")).body.data.rides).toBe(2);
    expect((await get("?until=06-05")).status).toBe(400);
  });
});
