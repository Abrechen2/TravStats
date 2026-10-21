import { prisma } from "../../../db";
import { tripFlightWindows } from "../bounds";

/**
 * A flight entered with a date only stores a placeholder clock — noon on the
 * day at the airport (`DATE_ONLY`) or midnight UTC on the 1st (`UNKNOWN`).
 * That locates the flight on the calendar, never at a minute, so it must not
 * arm a recorder window: one built from noon would drop the traveller's real
 * ground points around midday as "in flight" while the phone is told the
 * upload succeeded.
 */

const PREFIX = "triprec-windows-";

describe("tripFlightWindows — placeholder clocks arm nothing", () => {
  let userId: string;
  let tripId: string;

  const flight = (data: Record<string, unknown>) =>
    prisma.flight.create({
      data: {
        userId,
        tripId,
        depIata: "HND",
        arrIata: "ITM",
        depLat: 35.55,
        depLon: 139.78,
        arrLat: 34.79,
        arrLon: 135.44,
        status: "flown",
        ...data,
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    userId = (await prisma.user.create({ data: { username: `${PREFIX}a`, passwordHash: "x" } })).id;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    tripId = (
      await prisma.trip.create({
        data: {
          userId,
          name: "Tokio",
          startDay: new Date("2026-05-01T00:00:00Z"),
          endDay: new Date("2026-05-03T00:00:00Z"),
          startZone: "Asia/Tokyo",
          endZone: "Asia/Tokyo",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("gives a date-only flight (noon placeholder on both ends) no window", async () => {
    // Noon in Tokyo on 2 May, as the form writes a date-only flight.
    await flight({
      departureTime: new Date("2026-05-02T03:00:00Z"),
      arrivalTime: new Date("2026-05-02T03:00:00Z"),
      depTimeSemantics: "DATE_ONLY",
      arrTimeSemantics: "DATE_ONLY",
      depTimezone: "Asia/Tokyo",
      arrTimezone: "Asia/Tokyo",
      depPrecision: "day",
      arrPrecision: "day",
    });
    expect(await tripFlightWindows(userId, tripId)).toEqual([]);
  });

  it("gives a year-only placeholder (UNKNOWN, midnight on the 1st) no window", async () => {
    await flight({
      departureTime: new Date("2026-05-01T00:00:00Z"),
      arrivalTime: new Date("2026-05-01T00:00:00Z"),
      depTimeSemantics: "UNKNOWN",
      arrTimeSemantics: "UNKNOWN",
      depPrecision: "year",
      arrPrecision: "year",
    });
    expect(await tripFlightWindows(userId, tripId)).toEqual([]);
  });

  it("still arms the window of a flight with real clocks", async () => {
    await flight({
      departureTime: new Date("2026-05-02T03:00:00Z"),
      arrivalTime: new Date("2026-05-02T05:00:00Z"),
    });
    expect(await tripFlightWindows(userId, tripId)).toEqual([
      [Date.parse("2026-05-02T02:30:00Z"), Date.parse("2026-05-02T05:30:00Z")],
    ]);
  });

  it("builds the window from the one real end when the other is a placeholder", async () => {
    await flight({
      departureTime: new Date("2026-05-02T03:00:00Z"),
      arrivalTime: new Date("2026-05-02T03:00:00Z"),
      arrTimeSemantics: "DATE_ONLY",
      arrTimezone: "Asia/Tokyo",
      arrPrecision: "day",
    });
    expect(await tripFlightWindows(userId, tripId)).toEqual([
      [Date.parse("2026-05-02T02:30:00Z"), Date.parse("2026-05-02T03:30:00Z")],
    ]);
  });
});
