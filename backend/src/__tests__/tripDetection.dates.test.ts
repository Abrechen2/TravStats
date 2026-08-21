import request from "supertest";
import app from "../index";
import { prisma } from "../db";

/**
 * The second silent trip-creation site: "detect trips" proposals
 * (services/tripDetectionService.ts, commitProposals). Same defect class as
 * the batch import — a trip born from three dated flights carried NULL
 * start/end dates (board item auto-created-trip-has-no-dates).
 */
describe("trip detection — committed trips carry their date range", () => {
  let cookie: string[];
  let userId: string;

  const COORDS = { depLat: 50.03, depLon: 8.56, arrLat: -23.43, arrLon: -46.47 };

  const clean = async (): Promise<void> => {
    await prisma.flightCompanion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.userSettings.deleteMany();
    await prisma.user.deleteMany();
  };

  beforeEach(async () => {
    await clean();
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "detect-dates", password: "password123" })
      .expect(201);
    cookie = registration.headers["set-cookie"];
    const user = await prisma.user.findUniqueOrThrow({ where: { username: "detect-dates" } });
    userId = user.id;
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("fills startDate/endDate from the linked flights", async () => {
    await prisma.flight.createMany({
      data: [
        {
          userId,
          flightNumber: "LH506",
          bookingReference: "9VLVKC",
          depIata: "FRA",
          arrIata: "GRU",
          ...COORDS,
          departureTime: new Date("2026-08-28T20:05:00Z"),
          arrivalTime: new Date("2026-08-29T08:25:00Z"),
        },
        {
          userId,
          flightNumber: "G31402",
          bookingReference: "9VLVKC",
          depIata: "GRU",
          arrIata: "GIG",
          ...COORDS,
          departureTime: new Date("2026-09-01T12:00:00Z"),
          arrivalTime: new Date("2026-09-01T13:00:00Z"),
        },
        {
          userId,
          flightNumber: "LH507",
          bookingReference: "9VLVKC",
          depIata: "GIG",
          arrIata: "FRA",
          ...COORDS,
          departureTime: new Date("2026-09-06T21:15:00Z"),
          arrivalTime: new Date("2026-09-07T08:45:00Z"),
        },
      ],
    });

    await request(app)
      .post("/api/v1/trips/detect")
      .set("Cookie", cookie)
      .send({ dryRun: false })
      .expect(200);

    const trip = await prisma.trip.findFirstOrThrow({ where: { userId } });
    expect(trip.startDate?.toISOString()).toBe("2026-08-28T20:05:00.000Z");
    expect(trip.endDate?.toISOString()).toBe("2026-09-07T08:45:00.000Z");
  });
});
