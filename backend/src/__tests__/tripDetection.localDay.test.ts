import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { detectTrips } from "../services/tripDetectionService";

/**
 * Silent-failure review 2026-09-26: a detected trip's span and leg dates were
 * the UTC day of each departure. A 06:00 departure from Tokyo-Narita is 21:00
 * UTC the evening before, so the proposal said the journey began a day before
 * the traveller left.
 */
const USERNAME = `detect-localday-${Date.now()}`;

describe("trip detection — proposal days are the departure airport's days", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("starts a trip leaving NRT at 06:00 local on the local day", async () => {
    const leg = (flightNumber: string, dep: string, arr: string, at: string) => ({
      userId,
      flightNumber,
      bookingReference: "LOCDAY",
      depIata: dep,
      arrIata: arr,
      depLat: 35.76,
      depLon: 140.39,
      arrLat: 50.03,
      arrLon: 8.57,
      departureTime: new Date(at),
      arrivalTime: new Date(new Date(at).getTime() + 3 * 3600_000),
    });
    await prisma.flight.createMany({
      data: [
        // 2026-10-01 06:00 in Tokyo.
        leg("NH209", "NRT", "FRA", "2026-09-30T21:00:00Z"),
        leg("LH100", "FRA", "MUC", "2026-10-03T08:00:00Z"),
        leg("LH714", "MUC", "NRT", "2026-10-08T10:00:00Z"),
      ],
    });

    const result = await detectTrips({ userId, dryRun: true });
    const proposal = result.proposed.find((p) => p.pnr === "LOCDAY");

    expect(proposal?.span.from).toBe("2026-10-01");
    expect(proposal?.legs[0].date).toBe("2026-10-01");
    expect(proposal?.span.to).toBe("2026-10-08");
  });
});
