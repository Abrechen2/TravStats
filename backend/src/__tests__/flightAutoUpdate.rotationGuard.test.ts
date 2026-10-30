/**
 * Regression tests for the EK415 day-shift (prod, 2026-08-11):
 *
 *   1. The API lookup date must be the LOCAL departure day at the departure
 *      airport, not the UTC day of the stored instant. EK415 departs SYD
 *      11 Aug 06:00 local = 10 Aug 20:00 UTC; querying "2026-08-10" returned
 *      the previous rotation.
 *   2. Rotation guard: when the API's scheduled departure is > 12h away from
 *      ours, it is a different rotation of a daily flight number — its data
 *      must be rejected, not proposed (or auto-applied) onto our flight.
 */
import { prisma } from "../db";
import { checkAndUpdateFlightsForUser } from "../services/flightAutoUpdate";
import { lookupFlightDetails } from "../services/flightLookup";
import { Flight } from "../prisma";

jest.mock("../services/flightLookup", () => ({
  ...jest.requireActual("../services/flightLookup"),
  lookupFlightDetails: jest.fn(),
}));

jest.mock("../services/airportCache", () => ({
  ...jest.requireActual("../services/airportCache"),
  getCachedAirport: jest.fn(async (code: string) => {
    if (code === "SYD") return { iata: "SYD", timezone: "Australia/Sydney" };
    if (code === "DXB") return { iata: "DXB", timezone: "Asia/Dubai" };
    return null;
  }),
}));

const lookupMock = lookupFlightDetails as jest.MockedFunction<typeof lookupFlightDetails>;

describe("flightAutoUpdate — local lookup date + rotation guard", () => {
  let userId: string;
  let flight: Flight;

  // Stored as real UTC: 10 Aug 20:00Z == 11 Aug 06:00 Sydney local.
  const DEP_UTC = new Date("2026-08-10T20:00:00Z");
  const ARR_UTC = new Date("2026-08-11T10:10:00Z");

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `rotguard${Date.now()}`, passwordHash: "testhash" },
    });
    userId = user.id;
    await prisma.userSettings.create({
      data: {
        userId,
        data: {},
        autoUpdateEnabled: true,
        autoUpdateRequireApproval: true,
      },
    });
  });

  beforeEach(async () => {
    lookupMock.mockReset();
    flight = await prisma.flight.create({
      data: {
        userId,
        airline: "Emirates",
        flightNumber: "EK415",
        depIata: "SYD",
        arrIata: "DXB",
        depLat: -33.9461,
        depLon: 151.1772,
        arrLat: 25.2532,
        arrLon: 55.3657,
        departureTime: DEP_UTC,
        arrivalTime: ARR_UTC,
        depTimeSemantics: "UTC",
        arrTimeSemantics: "UTC",
        status: "scheduled",
        nextApiCheckAt: new Date(Date.now() - 60_000),
      },
    });
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

  it("queries the API with the LOCAL departure day, not the UTC day", async () => {
    lookupMock.mockResolvedValue(null);

    await checkAndUpdateFlightsForUser(userId);

    expect(lookupMock).toHaveBeenCalledTimes(1);
    // Sydney local day of 2026-08-10T20:00Z is 2026-08-11 — the UTC day
    // (2026-08-10) is the previous rotation and caused the day-shift bug.
    expect(lookupMock.mock.calls[0][1]).toBe("2026-08-11");
  });

  it("rejects API data from the wrong rotation (±24h) instead of proposing it", async () => {
    lookupMock.mockResolvedValue({
      source: "airlabs",
      // The PREVIOUS day's rotation — exactly what the buggy lookup returned.
      departureTime: "2026-08-09T20:00:00Z",
      arrivalTime: "2026-08-10T10:00:00Z",
    });

    await checkAndUpdateFlightsForUser(userId);

    const updates = await prisma.pendingFlightUpdate.findMany({
      where: { flightId: flight.id },
    });
    expect(updates).toHaveLength(0);
  });

  it("still proposes genuine same-rotation schedule changes", async () => {
    lookupMock.mockResolvedValue({
      source: "airlabs",
      // 40 minutes late — a real schedule change, well inside the guard.
      departureTime: "2026-08-10T20:40:00Z",
      arrivalTime: "2026-08-11T10:50:00Z",
    });

    await checkAndUpdateFlightsForUser(userId);

    const updates = await prisma.pendingFlightUpdate.findMany({
      where: { flightId: flight.id },
    });
    expect(updates).toHaveLength(1);
  });
});

describe("flightAutoUpdate — departure airport", () => {
  it("passes the departure airport so a two-leg flight number cannot match the other leg", async () => {
    const user = await prisma.user.create({
      data: { username: `depap${Date.now()}`, passwordHash: "testhash" },
    });
    await prisma.userSettings.create({
      data: { userId: user.id, data: {}, autoUpdateEnabled: true, autoUpdateRequireApproval: true },
    });
    await prisma.flight.create({
      data: {
        userId: user.id,
        airline: "Lufthansa",
        flightNumber: "LH400",
        depIata: "MUC",
        arrIata: "JFK",
        depLat: 48.35,
        depLon: 11.78,
        arrLat: 40.64,
        arrLon: -73.78,
        departureTime: new Date("2026-08-10T10:00:00Z"),
        arrivalTime: new Date("2026-08-10T18:00:00Z"),
        depTimeSemantics: "UTC",
        arrTimeSemantics: "UTC",
        status: "scheduled",
        nextApiCheckAt: new Date(Date.now() - 60_000),
      },
    });
    lookupMock.mockReset();
    lookupMock.mockResolvedValue(null);

    await checkAndUpdateFlightsForUser(user.id);

    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(lookupMock.mock.calls[0][5]).toBe("MUC");
    await prisma.flight.deleteMany({ where: { userId: user.id } });
    await prisma.userSettings.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});

describe("flightAutoUpdate — provider failure", () => {
  it("retries soon when a provider failed after the last checkpoint instead of ending tracking", async () => {
    const user = await prisma.user.create({
      data: { username: `provfail${Date.now()}`, passwordHash: "testhash" },
    });
    await prisma.userSettings.create({
      data: { userId: user.id, data: {}, autoUpdateEnabled: true, autoUpdateRequireApproval: true },
    });
    const now = Date.now();
    const f = await prisma.flight.create({
      data: {
        userId: user.id,
        airline: "Lufthansa",
        flightNumber: "LH401",
        depIata: "MUC",
        arrIata: "JFK",
        depLat: 48.35,
        depLon: 11.78,
        arrLat: 40.64,
        arrLon: -73.78,
        departureTime: new Date(now - 9 * 3_600_000),
        arrivalTime: new Date(now - 1 * 3_600_000),
        depTimeSemantics: "UTC",
        arrTimeSemantics: "UTC",
        status: "scheduled",
        nextApiCheckAt: new Date(now - 60_000),
      },
    });
    lookupMock.mockReset();
    lookupMock.mockImplementation(async (...args) => {
      (args[6] as { record: (p: string, o: string) => void }).record("aeroapi", "quota");
      return null;
    });

    await checkAndUpdateFlightsForUser(user.id);

    const after = await prisma.flight.findUniqueOrThrow({ where: { id: f.id } });
    expect(after.nextApiCheckAt).not.toBeNull();
    expect(after.nextApiCheckAt!.getTime()).toBeGreaterThan(now);
    expect(after.nextApiCheckAt!.getTime()).toBeLessThanOrEqual(now + 20 * 60_000);
    await prisma.flight.deleteMany({ where: { userId: user.id } });
    await prisma.userSettings.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
