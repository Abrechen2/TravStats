import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * Silent trip auto-creation during flight import (board items
 * trip-auto-creation-not-switchable + auto-created-trip-has-no-dates).
 *
 * Two behaviours pinned here:
 * 1. An auto-created trip carries the date range of its flights — the
 *    Sao-Paulo trip had four dated flights and NULL start/end.
 * 2. `autoCreateTrips = false` turns the whole silent PNR block off:
 *    no trip, no booking. Flights keep their booking reference, so the
 *    explicit "detect trips" button can still group them later.
 */
describe("flight batch import — trip auto-creation", () => {
  let cookie: string[];
  let userId: string;

  const clean = async (): Promise<void> => {
    await prisma.flightCompanion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.importBatch.deleteMany();
    await prisma.userSettings.deleteMany();
    await prisma.user.deleteMany();
  };

  beforeEach(async () => {
    await clean();
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "auto-trips", password: "password123" })
      .expect(201);
    cookie = registration.headers["set-cookie"];
    const user = await prisma.user.findUniqueOrThrow({ where: { username: "auto-trips" } });
    userId = user.id;
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  const legs = (): Array<Record<string, unknown>> => [
    {
      flightNumber: "LH506",
      bookingReference: "9VLVKC",
      departure: { iata: "FRA", lat: 50.0379, lon: 8.5622 },
      arrival: { iata: "GRU", lat: -23.4356, lon: -46.4731 },
      departureLocal: "2026-08-28T22:05",
      depTimezone: "Europe/Berlin",
      arrivalLocal: "2026-08-29T05:25",
      arrTimezone: "America/Sao_Paulo",
      dataSource: "imported_generic_csv",
    },
    {
      flightNumber: "LH507",
      bookingReference: "9VLVKC",
      departure: { iata: "GRU", lat: -23.4356, lon: -46.4731 },
      arrival: { iata: "FRA", lat: 50.0379, lon: 8.5622 },
      departureLocal: "2026-09-06T18:15",
      depTimezone: "America/Sao_Paulo",
      arrivalLocal: "2026-09-07T10:45",
      arrTimezone: "Europe/Berlin",
      dataSource: "imported_generic_csv",
    },
  ];

  const post = (body: unknown) =>
    request(app).post("/api/v1/flights/batch").set("Cookie", cookie).send(body);

  it("an auto-created trip carries the date range of its flights", async () => {
    await post(legs()).expect(201);

    const trip = await prisma.trip.findFirstOrThrow({ where: { userId } });
    const flights = await prisma.flight.findMany({ where: { userId } });
    const departures = flights
      .map((f) => f.departureTime)
      .filter((d): d is Date => d != null)
      .map((d) => d.getTime());
    const arrivals = flights
      .map((f) => f.arrivalTime)
      .filter((d): d is Date => d != null)
      .map((d) => d.getTime());

    expect(trip.startDate?.getTime()).toBe(Math.min(...departures));
    expect(trip.endDate?.getTime()).toBe(Math.max(...arrivals));
  });

  it("autoCreateTrips=false imports the flights but creates neither trip nor booking", async () => {
    await prisma.userSettings.upsert({
      where: { userId },
      update: { autoCreateTrips: false },
      create: { userId, data: {}, autoCreateTrips: false },
    });

    const res = await post(legs()).expect(201);
    expect(res.body.count).toBe(2);

    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
    expect(await prisma.booking.count({ where: { userId } })).toBe(0);

    const flights = await prisma.flight.findMany({ where: { userId } });
    expect(flights).toHaveLength(2);
    for (const f of flights) {
      expect(f.tripId).toBeNull();
      expect(f.bookingId).toBeNull();
      // The PNR must survive so "detect trips" can still group later.
      expect(f.bookingReference).toBe("9VLVKC");
    }
  });

  it("an untouched settings row defaults to auto-creating the trip", async () => {
    const settings = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(settings.autoCreateTrips).toBe(true);

    await post(legs()).expect(201);
    expect(await prisma.trip.count({ where: { userId } })).toBe(1);
    expect(await prisma.booking.count({ where: { userId } })).toBe(1);
  });
});
