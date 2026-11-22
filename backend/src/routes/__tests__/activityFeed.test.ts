import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as instanceSettings from "../../services/instanceSettingsService";
import { FEED_DOMAINS } from "../../services/activityFeed/types";

/**
 * `GET /activity/feed` — the dashboard's "Aktivität" list. Pinned: every
 * domain is present, planned entries sit on top (newest first), ties break by
 * domain then id so a cursor never repeats or skips a row, ownership, domain
 * gating, and that a bad cursor is a 400 instead of page one again.
 */
describe("GET /api/v1/activity/feed", () => {
  let user: { id: string };
  let other: { id: string };
  let cookie: string;
  const stamp = Date.now();
  const FUTURE = new Date(Date.now() + 40 * 86_400_000);
  const FUTURE_STAY = new Date(FUTURE.getTime() + 3_600_000);
  const FUTURE_LATER = new Date(Date.now() + 80 * 86_400_000);
  const PAST = new Date("2025-06-01T09:00:00Z");
  const SAME = new Date("2025-03-10T10:00:00Z");

  const feed = (query: Record<string, string> = {}, c = cookie) =>
    request(app).get("/api/v1/activity/feed").query(query).set("Cookie", c);

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

  const ride = (userId: string, at: Date, extra: Record<string, unknown> = {}) => ({
    userId,
    depStationName: "Zürich HB",
    arrStationName: "Bern",
    departureTime: at,
    depLat: 47.37,
    depLon: 8.54,
    arrLat: 46.95,
    arrLon: 7.44,
    geometrySource: "none",
    ...extra,
  });

  beforeAll(async () => {
    // Roadtrips and tours sit behind the instance's beta switch.
    const real = await instanceSettings.getInstanceSettings();
    jest
      .spyOn(instanceSettings, "getInstanceSettings")
      .mockResolvedValue({ ...real, betaFeaturesEnabled: true });
    user = await make("feed");
    other = await make("feed-other");
    cookie = `auth_token=${generateToken(user.id)}`;
    await prisma.userSettings.create({
      data: {
        userId: user.id,
        data: {},
        enabledDomains: [...FEED_DOMAINS].filter((d) => d !== "ferry"),
      },
    });
    await prisma.userSettings.create({
      data: { userId: other.id, data: {}, enabledDomains: [...FEED_DOMAINS] },
    });

    await prisma.flight.createMany({
      data: [
        flight(user.id, { flightNumber: "LH-FUT", departureTime: FUTURE, status: "scheduled" }),
        flight(user.id, { flightNumber: "LH-PAST", departureTime: PAST }),
        flight(user.id, { flightNumber: "LH-UNDATED", departureTime: null }),
        flight(user.id, { flightNumber: "LH-CANCELLED", departureTime: PAST, status: "cancelled" }),
        flight(other.id, { flightNumber: "LH-SECRET", departureTime: PAST }),
      ],
    });
    // Two rides at the very same instant: the order between them must be total.
    await prisma.railJourney.create({ data: ride(user.id, SAME, { trainNumber: "ICE 1" }) });
    await prisma.railJourney.create({ data: ride(user.id, SAME, { trainNumber: "ICE 2" }) });
    await prisma.railJourney.create({
      data: ride(user.id, FUTURE_LATER, { trainNumber: "ICE 9" }),
    });
    await prisma.railJourney.create({ data: ride(other.id, PAST, { trainNumber: "SECRET" }) });
    await prisma.busJourney.create({ data: ride(user.id, SAME, { lineName: "Bus 7" }) });
    // Ferry is switched off for this account: it must not surface.
    await prisma.ferryJourney.create({ data: ride(user.id, PAST, { vesselName: "Hidden" }) });

    const lodging = await prisma.lodging.create({
      data: {
        userId: user.id,
        name: "Hotel Zephyr",
        city: "Lisbon",
        type: "hotel",
        lat: 38.7,
        lon: -9.1,
      },
    });
    await prisma.lodgingStay.create({
      data: { userId: user.id, lodgingId: lodging.id, checkIn: PAST, checkOut: PAST },
    });
    await prisma.lodgingStay.create({
      data: { userId: user.id, lodgingId: lodging.id, checkIn: FUTURE_STAY, checkOut: FUTURE_STAY },
    });
    const place = await prisma.place.create({
      data: { userId: user.id, name: "Zephyr Museum", category: "museum", lat: 38.7, lon: -9.1 },
    });
    await prisma.placeVisit.create({
      data: { userId: user.id, placeId: place.id, visitedAt: SAME },
    });
    await prisma.cruise.create({
      data: {
        userId: user.id,
        shipNameOverride: "Aurora",
        startDate: PAST,
        endDate: PAST,
        status: "completed",
      },
    });
    await prisma.rentalBooking.create({
      data: {
        userId: user.id,
        provider: "sixt",
        pickupStationName: "Lisbon Airport",
        pickupLat: 38.77,
        pickupLon: -9.13,
        pickupTimezone: "Europe/Lisbon",
        pickupTime: PAST,
        returnStationName: "Lisbon Airport",
        returnLat: 38.77,
        returnLon: -9.13,
        returnTimezone: "Europe/Lisbon",
        returnTime: PAST,
      },
    });
    await prisma.tripRoute.create({
      data: { userId: user.id, name: "Brocken", kind: "tour", mode: "walk", tourDate: PAST },
    });
    const road = await prisma.tripRoute.create({
      data: { userId: user.id, name: "Algarve loop", kind: "roadtrip", mode: "car" },
    });
    await prisma.tripStop.createMany({
      data: [
        { routeId: road.id, title: "Faro", lat: 37.0, lon: -7.9, startDate: PAST },
        { routeId: road.id, title: "Lagos", lat: 37.1, lon: -8.7, startDate: PAST },
      ],
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  });

  const all = async () => (await feed({ limit: "200" })).body.data;

  it("answers every domain the account may see, and none it has switched off", async () => {
    const data = await all();
    const seen = new Set(data.items.map((i: { domain: string }) => i.domain));
    for (const d of FEED_DOMAINS.filter((d) => d !== "ferry")) expect(seen).toContain(d);
    expect(seen).not.toContain("ferry");
    expect(data.domains).not.toContain("ferry");
    expect(data.failed).toEqual([]);
  });

  it("puts planned entries on top, newest first, and labels them planned", async () => {
    const data = await all();
    const titles = data.items.map(
      (i: { title: string; subtitle: string | null }) => i.subtitle ?? i.title
    );
    const planned = data.items.filter((i: { planned: boolean }) => i.planned);
    expect(planned.length).toBe(3);
    // The first rows are exactly the planned ones, descending by time.
    expect(data.items.slice(0, 3).map((i: { planned: boolean }) => i.planned)).toEqual([
      true,
      true,
      true,
    ]);
    expect(data.items[0].sortAt > data.items[1].sortAt).toBe(true);
    expect(data.items[1].sortAt > data.items[2].sortAt).toBe(true);
    expect(data.items[0].domain).toBe("rail"); // FUTURE_LATER
    // Undated entries close the list.
    expect(data.items[data.items.length - 1].sortAt).toBeNull();
    expect(titles.join("|")).not.toContain("CANCELLED");
  });

  it("never returns another account's entries", async () => {
    const data = await all();
    expect(JSON.stringify(data.items)).not.toMatch(/SECRET/);
  });

  it("pages without repeating or skipping a row, ties included", async () => {
    const full = (await all()).items.map((i: { key: string }) => i.key);
    expect(new Set(full).size).toBe(full.length);
    for (const limit of [1, 2, 3, 5]) {
      const keys: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 100; guard++) {
        const res = await feed({ limit: String(limit), ...(cursor ? { cursor } : {}) });
        expect(res.status).toBe(200);
        // A reader that errored mid-paging would thin the list silently: it must not error.
        expect(res.body.data.failed).toEqual([]);
        keys.push(...res.body.data.items.map((i: { key: string }) => i.key));
        cursor = res.body.data.nextCursor ?? undefined;
        if (!cursor) break;
      }
      expect(keys).toEqual(full);
    }
  });

  it("carries the place to zoom to: a point for one place, a bbox for a route", async () => {
    const data = await all();
    const stay = data.items.find(
      (i: { domain: string; planned: boolean }) => i.domain === "lodging" && i.planned
    );
    expect(stay.point).toEqual({ lat: 38.7, lon: -9.1 });
    expect(stay.bbox).toBeNull();
    const rail = data.items.find((i: { subtitle: string }) => i.subtitle === "Zürich HB → Bern");
    expect(rail.point).toBeNull();
    expect(rail.bbox).toEqual([7.44, 46.95, 8.54, 47.37]);
    // A stay selects its HOTEL, a visit its PLACE.
    expect(stay.subjectId).not.toBe(stay.id);
  });

  it("shows a flight's day on the departure airport's clock", async () => {
    const data = await all();
    const f = data.items.find(
      (i: { title: string }) => i.title === "MUC → VIE" && !i.planned && i.sortAt
    );
    expect(f.date).toMatchObject({ precision: "day" });
  });

  it("refuses a malformed cursor, limit or domain instead of answering page one", async () => {
    expect((await feed({ cursor: "not-a-cursor" })).status).toBe(400);
    const forged = Buffer.from(JSON.stringify({ t: 1e100, r: 0, i: "x" })).toString("base64url");
    expect((await feed({ cursor: forged })).status).toBe(400);
    expect((await feed({ limit: "0" })).status).toBe(400);
    expect((await feed({ limit: "5000" })).status).toBe(400);
    expect((await feed({ domains: "flight,bogus" })).status).toBe(400);
    expect((await request(app).get("/api/v1/activity/feed")).status).toBe(401);
  });

  it("narrows to the requested domains but never widens past the visible ones", async () => {
    const res = await feed({ domains: "flight,ferry", limit: "200" });
    const seen = new Set(res.body.data.items.map((i: { domain: string }) => i.domain));
    expect([...seen]).toEqual(["flight"]);
  });
});
