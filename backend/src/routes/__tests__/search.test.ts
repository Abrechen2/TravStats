import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as instanceSettings from "../../services/instanceSettingsService";
import { TOTAL_CAP } from "../../services/search/globalSearch";

/**
 * `GET /search` (forgejo#403): one query across domains. Pinned: ownership,
 * domain gating (enabled domains, beta switch), per-domain and total caps,
 * newest-first stable ordering, the minimum query length, and that a failing
 * domain is reported rather than shown as "no match".
 */
describe("GET /api/v1/search", () => {
  let user: { id: string };
  let other: { id: string };
  let cookie: string;
  const stamp = Date.now();

  const search = (query: Record<string, string>) =>
    request(app).get("/api/v1/search").query(query).set("Cookie", cookie);

  const make = async (name: string) =>
    prisma.user.create({
      data: {
        username: `${name}-${stamp}`,
        passwordHash: await hashPassword("test-password"),
        isAdmin: false,
        isActive: true,
      },
    });

  const flight = (userId: string, extra: Record<string, unknown> = {}) => ({
    userId,
    flightNumber: "LH123",
    airline: "Lufthansa",
    airlineIata: "LH",
    depIata: "MUC",
    depLat: 48.35,
    depLon: 11.78,
    arrIata: "VIE",
    arrLat: 48.11,
    arrLon: 16.57,
    status: "flown",
    ...extra,
  });

  const ride = (userId: string, extra: Record<string, unknown> = {}) => ({
    userId,
    depStationName: "Zürich HB",
    arrStationName: "Zephyria Central",
    departureTime: new Date("2026-03-01T08:00:00Z"),
    depLat: 47.37,
    depLon: 8.54,
    arrLat: 47.4,
    arrLon: 8.6,
    geometrySource: "none",
    ...extra,
  });

  beforeAll(async () => {
    user = await make("search");
    other = await make("search-other");
    cookie = `auth_token=${generateToken(user.id)}`;
    await prisma.userSettings.create({
      data: {
        userId: user.id,
        data: {},
        enabledDomains: ["flight", "cruise", "lodging", "poi", "rail", "bus", "ferry", "rental"],
      },
    });

    await prisma.flight.createMany({
      data: [
        flight(user.id, { departureTime: new Date("2026-01-01T10:00:00Z") }),
        flight(user.id, { flightNumber: "LH456", departureTime: new Date("2026-02-01T10:00:00Z") }),
        flight(user.id, { flightNumber: "LH789", depIata: "FRA", departureTime: null }),
        flight(other.id, { flightNumber: "LH999 secret-other" }),
      ],
    });
    await prisma.trip.create({ data: { userId: user.id, name: "Wien Zephyr 2026" } });
    await prisma.trip.create({ data: { userId: other.id, name: "Zephyr secret" } });
    await prisma.lodging.create({
      data: { userId: user.id, name: "Hotel Zephyr", city: "Lisbon", type: "hotel" },
    });
    await prisma.place.create({
      data: { userId: user.id, name: "Zephyr Museum", category: "museum", lat: 38.7, lon: -9.1 },
    });
    await prisma.railJourney.create({ data: ride(user.id, { trainNumber: "ICE 77" }) });
    await prisma.railJourney.create({ data: ride(other.id, { trainNumber: "ICE 66" }) });
    await prisma.tripRoute.create({
      data: { userId: user.id, name: "Zephyr tour", kind: "tour", mode: "walk" },
    });
    await prisma.tripRoute.create({
      data: { userId: user.id, name: "Zephyr roadtrip", kind: "roadtrip", mode: "car" },
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  });

  it("refuses a query shorter than two characters instead of scanning on one letter", async () => {
    expect((await search({ q: "L" })).status).toBe(400);
    expect((await search({ q: " " })).status).toBe(400);
    expect((await request(app).get("/api/v1/search?q=lufthansa")).status).toBe(401);
  });

  it("rejects an unknown domain name rather than silently searching nothing", async () => {
    const res = await search({ q: "lh", domains: "flight,bogus" });
    expect(res.status).toBe(400);
  });

  it("finds a flight by number, airline and a typed route, newest first, undated last", async () => {
    const byNumber = await search({ q: "lh", domains: "flight" });
    expect(byNumber.status).toBe(200);
    const titles = byNumber.body.data.hits.map((h: { title: string }) => h.title);
    expect(titles).toEqual(["LH456", "LH123", "LH789"]);
    expect(byNumber.body.data.hits[0]).toMatchObject({
      domain: "flight",
      kind: "flight",
      subtitle: "MUC → VIE · Lufthansa",
      path: expect.stringMatching(/^\/flights\/.+/),
    });

    const route = await search({ q: "FRA-VIE", domains: "flight" });
    expect(route.body.data.hits.map((h: { title: string }) => h.title)).toEqual(["LH789"]);
  });

  it("never returns another account's entries", async () => {
    const res = await search({ q: "secret" });
    expect(res.status).toBe(200);
    expect(res.body.data.hits).toEqual([]);
  });

  it("searches stays, places, rides and trips and builds their deep links", async () => {
    const res = await search({ q: "zephyr" });
    const byDomain = Object.fromEntries(
      res.body.data.hits.map((h: { domain: string; path: string }) => [h.domain, h.path])
    );
    expect(byDomain.lodging).toMatch(/^\/lodging\//);
    expect(byDomain.poi).toMatch(/^\/places\//);
    expect(byDomain.rail).toMatch(/^\/rail\//); // matched on the arrival station
    expect(byDomain.trip).toMatch(/^\/trips\//);
  });

  it("leaves out domains the account has not enabled and tours/roadtrips while beta is closed", async () => {
    const res = await search({ q: "zephyr" });
    const domains = new Set(res.body.data.hits.map((h: { domain: string }) => h.domain));
    expect(domains.has("tour")).toBe(false);
    expect(domains.has("roadtrip")).toBe(false);

    // Naming a hidden domain explicitly does not widen the scope.
    const asked = await search({ q: "zephyr", domains: "tour,roadtrip,cruise" });
    expect(asked.body.data.hits).toEqual([]);
  });

  it("drops a domain the user switched off, even when it holds matches", async () => {
    await prisma.userSettings.update({
      where: { userId: user.id },
      data: { enabledDomains: ["flight"] },
    });
    try {
      const res = await search({ q: "zephyr" });
      const domains = new Set(res.body.data.hits.map((h: { domain: string }) => h.domain));
      expect([...domains]).toEqual(["trip"]);
    } finally {
      await prisma.userSettings.update({
        where: { userId: user.id },
        data: {
          enabledDomains: ["flight", "cruise", "lodging", "poi", "rail", "bus", "ferry", "rental"],
        },
      });
    }
  });

  it("includes tours and roadtrips once the instance's beta switch is on", async () => {
    const real = await instanceSettings.getInstanceSettings();
    const spy = jest
      .spyOn(instanceSettings, "getInstanceSettings")
      .mockResolvedValue({ ...real, betaFeaturesEnabled: true });
    await prisma.userSettings.update({
      where: { userId: user.id },
      data: { enabledDomains: ["flight", "roadtrip"] },
    });
    try {
      const res = await search({ q: "zephyr" });
      const hits = res.body.data.hits as Array<{ domain: string; path: string }>;
      expect(hits.find((h) => h.domain === "tour")?.path).toMatch(/^\/tours\//);
      expect(hits.find((h) => h.domain === "roadtrip")?.path).toMatch(/^\/roadtrips\//);
    } finally {
      spy.mockRestore();
      await prisma.userSettings.update({
        where: { userId: user.id },
        data: {
          enabledDomains: ["flight", "cruise", "lodging", "poi", "rail", "bus", "ferry", "rental"],
        },
      });
    }
  });

  it("bounds each domain by limit, says more exist, and treats % as a character", async () => {
    const res = await search({ q: "lh", domains: "flight", limit: "2" });
    expect(res.body.data.hits).toHaveLength(2);
    expect(res.body.data.more).toEqual(["flight"]);
    expect(res.body.data.capped).toBe(false);

    const wildcard = await search({ q: "l%" });
    expect(wildcard.body.data.hits).toEqual([]);
  });

  it("caps the total however many domains match", async () => {
    expect(TOTAL_CAP).toBe(60);
    const res = await search({ q: "zephyr", limit: "20" });
    expect(res.body.data.hits.length).toBeLessThanOrEqual(TOTAL_CAP);
  });

  it("reports a failing domain in `failed` instead of presenting it as no match", async () => {
    const spy = jest.spyOn(prisma.trip, "findMany").mockRejectedValue(new Error("boom"));
    try {
      const res = await search({ q: "lh", domains: "trip,flight" });
      expect(res.status).toBe(200);
      expect(res.body.data.failed).toEqual(["trip"]);
      expect(res.body.data.hits.length).toBeGreaterThan(0);

      // Every requested domain failing is an outage, not an empty answer.
      const all = await search({ q: "lh", domains: "trip" });
      expect(all.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});
