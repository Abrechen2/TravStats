/**
 * A tester, 2026-10-02: a flight still "geplant" two and a half hours after it
 * landed. When the live check hears the touchdown, the flight is flown at once;
 * the reported times themselves still go through the pending update, and
 * another day's rotation never lands the flight.
 */
import { prisma } from "../db";
import { checkAndUpdateFlightsForUser } from "../services/flightAutoUpdate";
import { lookupFlightDetails } from "../services/flightLookup";

jest.mock("../services/flightLookup", () => ({
  ...jest.requireActual("../services/flightLookup"),
  lookupFlightDetails: jest.fn(),
}));

jest.mock("../services/airportCache", () => ({
  ...jest.requireActual("../services/airportCache"),
  getCachedAirport: jest.fn(async (code: string) => {
    if (code === "FRA") return { iata: "FRA", timezone: "Europe/Berlin" };
    if (code === "LIS") return { iata: "LIS", timezone: "Europe/Lisbon" };
    return null;
  }),
}));

const lookupMock = lookupFlightDetails as jest.MockedFunction<typeof lookupFlightDetails>;
const MIN = 60_000;

describe("flightAutoUpdate — a reported landing ends 'scheduled'", () => {
  let userId: string;
  let flightId: string;
  const depAt = new Date(Date.now() - 150 * MIN);
  // The timetable still has the aircraft in the air for another ten minutes.
  const arrAt = new Date(Date.now() + 10 * MIN);

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `landed${Date.now()}`, passwordHash: "testhash" },
    });
    userId = user.id;
    await prisma.userSettings.create({
      data: { userId, data: {}, autoUpdateEnabled: true, autoUpdateRequireApproval: true },
    });
  });

  beforeEach(async () => {
    lookupMock.mockReset();
    const flight = await prisma.flight.create({
      data: {
        userId,
        airline: "Lufthansa",
        flightNumber: "LH1166",
        depIata: "FRA",
        arrIata: "LIS",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 38.77,
        arrLon: -9.13,
        departureTime: depAt,
        arrivalTime: arrAt,
        depTimeSemantics: "UTC",
        arrTimeSemantics: "UTC",
        status: "scheduled",
        nextApiCheckAt: new Date(Date.now() - MIN),
      },
    });
    flightId = flight.id;
  });

  afterEach(async () => {
    await prisma.pendingFlightUpdate.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("marks the flight flown when the provider reports a touchdown in the past", async () => {
    lookupMock.mockResolvedValue({
      source: "aeroapi",
      departureTime: depAt.toISOString(),
      arrivalTime: arrAt.toISOString(),
      actualDeparture: new Date(depAt.getTime() + 5 * MIN).toISOString(),
      actualArrival: new Date(Date.now() - 15 * MIN).toISOString(),
    });

    await checkAndUpdateFlightsForUser(userId);

    const row = await prisma.flight.findUnique({ where: { id: flightId } });
    expect(row?.status).toBe("flown");
    expect(row?.nextApiCheckAt).toBeNull();
    // The times are still a proposal under the user's review rule.
    expect(row?.actualArrival).toBeNull();
    const updates = await prisma.pendingFlightUpdate.findMany({ where: { flightId } });
    expect(updates).toHaveLength(1);
  });

  it("keeps it scheduled while the provider has no touchdown yet", async () => {
    lookupMock.mockResolvedValue({
      source: "aeroapi",
      departureTime: depAt.toISOString(),
      arrivalTime: arrAt.toISOString(),
      actualDeparture: new Date(depAt.getTime() + 5 * MIN).toISOString(),
    });

    await checkAndUpdateFlightsForUser(userId);

    expect((await prisma.flight.findUnique({ where: { id: flightId } }))?.status).toBe("scheduled");
  });

  it("never lands the flight on another day's rotation", async () => {
    lookupMock.mockResolvedValue({
      source: "aeroapi",
      departureTime: new Date(depAt.getTime() - 24 * 60 * MIN).toISOString(),
      arrivalTime: new Date(arrAt.getTime() - 24 * 60 * MIN).toISOString(),
      actualArrival: new Date(Date.now() - 24 * 60 * MIN).toISOString(),
    });

    await checkAndUpdateFlightsForUser(userId);

    expect((await prisma.flight.findUnique({ where: { id: flightId } }))?.status).toBe("scheduled");
  });
});
