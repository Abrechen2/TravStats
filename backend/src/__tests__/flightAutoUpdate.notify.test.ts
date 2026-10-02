import { prisma } from "../db";
import { checkAndUpdateFlightsForUser } from "../services/flightAutoUpdate";
import { lookupFlightDetails } from "../services/flightLookup";
import { notifyFlightChanged } from "../services/notifications/dispatcher";

/**
 * TravStats#156: a change the provider detected reaches the paired phones —
 * as "pending" when the user must approve it, as applied when auto-apply ran.
 */
jest.mock("../services/flightLookup", () => ({
  ...jest.requireActual("../services/flightLookup"),
  lookupFlightDetails: jest.fn(),
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
const notifyMock = notifyFlightChanged as jest.MockedFunction<typeof notifyFlightChanged>;

const DEP = new Date("2026-10-14T11:25:00Z");
const ARR = new Date("2026-10-15T05:30:00Z");

describe("flightAutoUpdate — push on detected changes", () => {
  let userId: string;

  const setApproval = (required: boolean) =>
    prisma.userSettings.update({
      where: { userId },
      data: { autoUpdateRequireApproval: required },
    });

  const makeFlight = (flightNumber: string) =>
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
        departureTime: DEP,
        arrivalTime: ARR,
        depTimeSemantics: "UTC",
        arrTimeSemantics: "UTC",
        status: "scheduled",
        gate: "A26",
        nextApiCheckAt: new Date(Date.now() - 60_000),
      },
    });

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `pushnotify${Date.now()}`, passwordHash: "testhash" },
    });
    userId = user.id;
    await prisma.userSettings.create({
      data: { userId, data: {}, autoUpdateEnabled: true, autoUpdateRequireApproval: true },
    });
  });

  beforeEach(() => {
    lookupMock.mockReset();
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

  it("announces a change that waits for approval as pending", async () => {
    await setApproval(true);
    const flight = await makeFlight("LH716");
    lookupMock.mockResolvedValue({ source: "airlabs", departure: { gate: "B44" } });

    await checkAndUpdateFlightsForUser(userId);

    expect(notifyMock).toHaveBeenCalledTimes(1);
    const [uid, sent, changes, opts] = notifyMock.mock.calls[0];
    expect(uid).toBe(userId);
    expect(sent).toMatchObject({
      id: flight.id,
      flightNumber: "LH716",
      depIata: "FRA",
      arrIata: "HND",
      depTimeSemantics: "UTC",
    });
    expect(changes.map((c) => c.field)).toContain("gate");
    expect(opts).toMatchObject({ pending: true });
  });

  it("announces an auto-applied change as not pending", async () => {
    await setApproval(false);
    await makeFlight("LH717");
    lookupMock.mockResolvedValue({ source: "airlabs", departure: { gate: "B44" } });

    await checkAndUpdateFlightsForUser(userId);

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][3]).toMatchObject({ pending: false });
  });

  it("passes the cancellation on", async () => {
    await setApproval(true);
    await makeFlight("LH718");
    lookupMock.mockResolvedValue({ source: "aerodatabox", statusOverride: "cancelled" });

    await checkAndUpdateFlightsForUser(userId);

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][3]).toMatchObject({ pending: true, cancelled: true });
  });

  it("stays silent when nothing significant changed", async () => {
    await setApproval(true);
    await makeFlight("LH719");
    lookupMock.mockResolvedValue({ source: "airlabs", departure: { gate: "A26" } });

    await checkAndUpdateFlightsForUser(userId);

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("a notifier that rejects or throws does not stop the next flight", async () => {
    await setApproval(true);
    await makeFlight("LH720");
    await makeFlight("LH721");
    lookupMock.mockResolvedValue({ source: "airlabs", departure: { gate: "B44" } });
    notifyMock.mockRejectedValueOnce(new Error("relay down"));
    notifyMock.mockImplementationOnce(() => {
      throw new Error("sync boom");
    });

    const created = await checkAndUpdateFlightsForUser(userId);

    expect(created).toBe(2);
    expect(notifyMock).toHaveBeenCalledTimes(2);
  });
});
