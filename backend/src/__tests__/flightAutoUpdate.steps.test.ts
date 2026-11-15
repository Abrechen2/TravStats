import { prisma } from "../db";
import { checkAndUpdateFlightsForUser } from "../services/flightAutoUpdate";
import { lookupFlightDetails } from "../services/flightLookup";
import { applyPendingUpdate } from "../services/pendingUpdateService";
import { notifyFlightChanged } from "../services/notifications/dispatcher";

/**
 * Characterization of the per-flight steps of the auto-update sweep
 * (forgejo#386 REF-15: `checkAndUpdateFlightsForUser` was split into one
 * function per step). Pins the exits the other suites do not reach.
 */
jest.mock("../services/flightLookup", () => ({
  ...jest.requireActual("../services/flightLookup"),
  lookupFlightDetails: jest.fn(),
}));
jest.mock("../services/pendingUpdateService", () => ({
  ...jest.requireActual("../services/pendingUpdateService"),
  applyPendingUpdate: jest.fn(),
}));
jest.mock("../services/notifications/dispatcher", () => ({
  notifyFlightChanged: jest.fn(),
  notifyReminder: jest.fn(),
}));
jest.mock("../services/airportCache", () => ({
  ...jest.requireActual("../services/airportCache"),
  getCachedAirport: jest.fn(async (code: string) => {
    if (code === "FRA") return { iata: "FRA", timezone: "Europe/Berlin" };
    if (code === "HND") return { iata: "HND", timezone: "Asia/Tokyo" };
    return null;
  }),
}));

const lookupMock = lookupFlightDetails as jest.MockedFunction<typeof lookupFlightDetails>;
const applyMock = applyPendingUpdate as jest.MockedFunction<typeof applyPendingUpdate>;
const notifyMock = notifyFlightChanged as jest.MockedFunction<typeof notifyFlightChanged>;

const DEP = new Date(Date.now() + 3600_000);
const ARR = new Date(Date.now() + 12 * 3600_000);

describe("flightAutoUpdate — per-flight steps", () => {
  let userId: string;

  const makeFlight = (flightNumber: string, departureTime: Date | null = DEP) =>
    prisma.flight.create({
      data: {
        userId,
        airline: "Lufthansa",
        flightNumber,
        depIata: "FRA",
        arrIata: "HND",
        depLat: 50.03,
        depLon: 8.56,
        arrLat: 35.55,
        arrLon: 139.78,
        departureTime,
        arrivalTime: departureTime ? ARR : null,
        depTimeSemantics: "UTC",
        arrTimeSemantics: "UTC",
        status: "scheduled",
        gate: "A26",
        nextApiCheckAt: new Date(Date.now() - 60_000),
      },
    });

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `autosteps${Date.now()}`, passwordHash: "testhash" },
    });
    userId = user.id;
    await prisma.userSettings.create({
      data: { userId, data: {}, autoUpdateEnabled: true, autoUpdateRequireApproval: false },
    });
  });

  beforeEach(() => {
    lookupMock.mockReset();
    applyMock.mockReset();
    notifyMock.mockReset();
    notifyMock.mockResolvedValue(undefined);
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

  it("clears the check slot of a flight without a departure time and does not look it up", async () => {
    const flight = await makeFlight("LH800", null);
    const created = await checkAndUpdateFlightsForUser(userId);
    expect(created).toBe(0);
    expect(lookupMock).not.toHaveBeenCalled();
    const row = await prisma.flight.findUnique({ where: { id: flight.id } });
    expect(row?.nextApiCheckAt).toBeNull();
  });

  it("reschedules the check and creates nothing when the provider has no data", async () => {
    const flight = await makeFlight("LH801");
    lookupMock.mockResolvedValue(null);
    const created = await checkAndUpdateFlightsForUser(userId);
    expect(created).toBe(0);
    const row = await prisma.flight.findUnique({ where: { id: flight.id } });
    expect(row?.nextApiCheckAt && row.nextApiCheckAt.getTime() > Date.now()).toBe(true);
    expect(await prisma.pendingFlightUpdate.count({ where: { userId } })).toBe(0);
  });

  it("marks the flight live-tracked on first data even when nothing changed", async () => {
    const flight = await makeFlight("LH802");
    lookupMock.mockResolvedValue({ source: "airlabs", departure: { gate: "A26" } });
    const created = await checkAndUpdateFlightsForUser(userId);
    expect(created).toBe(0);
    const row = await prisma.flight.findUnique({ where: { id: flight.id } });
    expect(row?.hasLiveTracking).toBe(true);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("leaves the pending update in place and announces it as pending when auto-apply fails", async () => {
    await makeFlight("LH803");
    lookupMock.mockResolvedValue({ source: "airlabs", departure: { gate: "B44" } });
    applyMock.mockResolvedValue(false as never);
    const created = await checkAndUpdateFlightsForUser(userId);
    expect(created).toBe(1);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][3]).toMatchObject({ pending: true });
    expect(await prisma.pendingFlightUpdate.count({ where: { userId } })).toBe(1);
  });
});
