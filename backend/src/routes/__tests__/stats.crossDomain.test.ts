import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { crossDomainStatsSchema } from "../../schemas/statsCrossDomain";

/**
 * GET /stats/cross-domain (forgejo#399): every block abstains (null, never a
 * zero) on an account with nothing to derive it from, and derives from the
 * rows a populated one holds. The pure rules are tested beside the functions.
 */
const dayOffset = (days: number): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

describe("cross-domain statistics", () => {
  const stamp = Date.now();
  let emptyId: string;
  let fullId: string;
  const cookieOf = (id: string): string => `auth_token=${generateToken(id)}`;
  const get = async (id: string) =>
    request(app).get("/api/v1/stats/cross-domain").set("Cookie", cookieOf(id));

  beforeAll(async () => {
    const make = async (name: string) =>
      (
        await prisma.user.create({
          data: { username: `${name}-${stamp}`, passwordHash: await hashPassword("pw123456") },
        })
      ).id;
    emptyId = await make("xd-empty");
    fullId = await make("xd-full");
    await prisma.userSettings.createMany({
      data: [
        { userId: emptyId, enabledDomains: ["flight"], data: {} },
        { userId: fullId, enabledDomains: ["flight", "lodging", "rail"], data: {} },
      ],
    });
    const lodging = await prisma.lodging.create({
      data: {
        userId: fullId,
        name: "Hotel Alpenblick",
        type: "hotel",
        lat: 47.4,
        lon: 11.1,
        isoCountryCode: "AT",
      },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: fullId,
        lodgingId: lodging.id,
        checkIn: dayOffset(-12),
        checkOut: dayOffset(-8),
        datePrecision: "DAY",
        status: "completed",
      },
    });
    await prisma.railJourney.create({
      data: {
        userId: fullId,
        depStationName: "Wien Hbf",
        depLat: 48.185,
        depLon: 16.376,
        depCountry: "AT",
        arrStationName: "Hamburg Hbf",
        arrLat: 53.553,
        arrLon: 10.007,
        arrCountry: "DE",
        departureTime: new Date(dayOffset(-8).getTime() + 20 * 3_600_000),
        arrivalTime: new Date(dayOffset(-7).getTime() + 8 * 3_600_000),
        distanceKm: 500,
        price: 100,
        currency: "EUR",
        status: "completed",
      },
    });
    // Frankfurt -> Tokyo two years ago: 8 h east in winter, and a country not seen for 2 years.
    await prisma.flight.create({
      data: {
        userId: fullId,
        depIata: "FRA",
        arrIata: "HND",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 35.55,
        arrLon: 139.78,
        departureTime: new Date("2024-01-10T10:00:00Z"),
        arrivalTime: new Date("2024-01-10T22:00:00Z"),
        depTimezone: "Europe/Berlin",
        arrTimezone: "Asia/Tokyo",
        depPrecision: "minute",
        arrPrecision: "minute",
        status: "flown",
      },
    });
    const trip = await prisma.trip.create({ data: { userId: fullId, name: "Tirol" } });
    await prisma.tripPhoto.createMany({
      data: [
        {
          tripId: trip.id,
          filename: "a.jpg",
          mimetype: "image/jpeg",
          sizeBytes: 1,
          takenAt: new Date("2026-05-01T10:00:00Z"),
          lat: 47.26,
          lon: 11.39,
        },
        { tripId: trip.id, filename: "b.jpg", mimetype: "image/jpeg", sizeBytes: 1 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [emptyId, fullId] } } });
  });

  it("abstains in every block on an account with no records, and matches the published schema", async () => {
    const res = await get(emptyId);
    expect(res.status).toBe(200);
    expect(crossDomainStatsSchema.parse(res.body)).toBeTruthy();
    expect(res.body).toMatchObject({
      streaks: null,
      rhythm: null,
      timeShift: null,
      unseen: null,
      pricePerKm: null,
      nightsByCountry: null,
      schengen: null,
      photos: null,
      unavailable: [],
    });
  });

  it("derives streaks, Schengen days, price per km and nights per country from the rows", async () => {
    const res = await get(fullId);
    expect(res.status).toBe(200);
    const body = crossDomainStatsSchema.parse(res.body);
    // Stay days -12..-9 (check-out day excluded) and the ride on -8..-7: one run of 6 days.
    expect(body.streaks?.longestDayStreak?.days).toBe(6);
    // Stay -12..-8 inclusive (5 days) plus the ride arriving in DE on -7.
    expect(body.schengen?.daysUsed).toBe(6);
    expect(body.schengen?.daysRemaining).toBe(84);
    expect(body.pricePerKm?.blocks).toEqual([
      expect.objectContaining({
        domain: "rail",
        currency: "EUR",
        spend: 100,
        km: 500,
        pricePerKm: 0.2,
      }),
    ]);
    const at = body.nightsByCountry?.countries.find((c) => c.country === "AT");
    expect(at?.hotel).toBe(4);
    // The Vienna-Hamburg sleeper crosses a border: its night is not given to either country.
    expect(body.nightsByCountry?.countries.some((c) => c.country === "DE")).toBe(false);
    expect(body.timeShift).toMatchObject({ flightsMeasured: 1, hoursShifted: 8 });
    expect(body.timeShift?.biggestJump).toMatchObject({ from: "FRA", to: "HND", hours: 8 });
    expect(body.unseen?.airport?.map((a) => a.key)).toEqual(["FRA", "HND"]);
    // The undated, coordinate-less photo counts as a photo and as nothing else.
    expect(body.photos).toMatchObject({ photos: 2, withoutDate: 1, withoutCountry: 1 });
    expect(body.photos?.topCountries).toEqual([{ key: "AT", label: "AT", count: 1 }]);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/stats/cross-domain")).status).toBe(401);
  });
});
