import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFindMany = jest.fn();
jest.mock("../../../db", () => ({
  prisma: { flight: { findMany: mockFindMany } },
}));

const mockSendFlightReminder = jest.fn();
jest.mock("../../emailService", () => ({
  sendFlightReminder: mockSendFlightReminder,
}));

jest.mock("../../airportCache", () => ({ getCachedAirport: jest.fn() }));

const mockNotifyReminder = jest.fn();
jest.mock("../../notifications/dispatcher", () => ({
  notifyReminder: mockNotifyReminder,
}));

const mockWarn = jest.fn();
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: mockWarn, error: jest.fn(), debug: jest.fn() },
}));

type UserFixture = {
  notificationEmail: string | null;
  notifyBefore24h: boolean;
  notifyBefore2h: boolean;
  settings: { data: unknown } | null;
};

function makeFlight(user: Partial<UserFixture> = {}, hoursAhead = 24, id = "flight-a") {
  return {
    id,
    tripId: null,
    flightNumber: "LH100",
    airline: null,
    aircraft: null,
    seatNumber: null,
    depName: "Munich",
    depIata: "MUC",
    depIcao: "EDDM",
    depLat: null,
    depLon: null,
    depTimezone: "Europe/Berlin",
    depTimeSemantics: "UTC",
    depPrecision: "minute",
    arrName: "Frankfurt",
    arrIata: "FRA",
    arrIcao: "EDDF",
    arrLat: null,
    arrLon: null,
    arrTimezone: "Europe/Berlin",
    arrTimeSemantics: "UTC",
    arrPrecision: "minute",
    departureTime: new Date(Date.now() + hoursAhead * 60 * 60 * 1000),
    arrivalTime: null,
    durationMinutes: null,
    actualDeparture: null,
    actualArrival: null,
    runwayDepartureTime: null,
    runwayArrivalTime: null,
    userId: "user-1",
    user: {
      notificationEmail: "user@example.com",
      notifyBefore24h: true,
      notifyBefore2h: true,
      settings: null,
      ...user,
    },
  };
}

/** The cron queries once per window: 24h first, then 2h. */
function stage(first: unknown[], second: unknown[] = []): void {
  mockFindMany.mockResolvedValueOnce(first);
  mockFindMany.mockResolvedValueOnce(second);
}

async function run(): Promise<void> {
  const { checkFlightReminders } = await import("../flightReminders");
  await checkFlightReminders(new Date());
}

describe("checkFlightReminders - push", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockFindMany.mockResolvedValue([]);
    mockNotifyReminder.mockResolvedValue(undefined);
  });

  it("pushes the 24h reminder for a user without notificationEmail, and sends no e-mail", async () => {
    stage([makeFlight({ notificationEmail: null })]);
    await run();

    expect(mockNotifyReminder).toHaveBeenCalledTimes(1);
    const [userId, flight, key] = mockNotifyReminder.mock.calls[0] as [
      string,
      { id: string },
      string,
    ];
    expect(userId).toBe("user-1");
    expect(flight.id).toBe("flight-a");
    expect(key).toBe("24h");
    expect(mockSendFlightReminder).not.toHaveBeenCalled();
  });

  it("pushes the 2h reminder with key 2h", async () => {
    stage([], [makeFlight({ notificationEmail: null }, 2)]);
    await run();

    expect(mockNotifyReminder).toHaveBeenCalledTimes(1);
    expect(mockNotifyReminder.mock.calls[0][2]).toBe("2h");
  });

  it("sends both e-mail and push when the user has both", async () => {
    stage([makeFlight()]);
    await run();

    expect(mockSendFlightReminder).toHaveBeenCalledTimes(1);
    expect(mockNotifyReminder).toHaveBeenCalledTimes(1);
  });

  it("pushes even when the e-mail switch for the window is off (the phone has its own switch)", async () => {
    stage([makeFlight({ notifyBefore24h: false })]);
    await run();

    expect(mockSendFlightReminder).not.toHaveBeenCalled();
    expect(mockNotifyReminder).toHaveBeenCalledTimes(1);
  });

  it("still e-mails (positive control) when the push notifier rejects, and logs a warning", async () => {
    mockNotifyReminder.mockRejectedValue(new Error("relay down"));
    stage([makeFlight()]);
    await run();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSendFlightReminder).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "flight_reminder_push_failed", flightId: "flight-a" }),
      expect.any(String)
    );
  });

  it("survives a notifier that throws synchronously", async () => {
    mockNotifyReminder.mockImplementation(() => {
      throw new Error("boom");
    });
    stage([makeFlight()]);
    await run();

    expect(mockSendFlightReminder).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "flight_reminder_push_failed" }),
      expect.any(String)
    );
  });

  it("does not push a flight outside the precise window (positive control: inside does)", async () => {
    stage([makeFlight({}, 26), makeFlight({}, 24, "flight-b")]);
    await run();

    expect(mockNotifyReminder).toHaveBeenCalledTimes(1);
    expect((mockNotifyReminder.mock.calls[0][1] as { id: string }).id).toBe("flight-b");
  });

  it("keeps trying the push on the next run (the dispatcher dedupes) but e-mails only once", async () => {
    const flight = makeFlight();
    stage([flight]);
    await run();
    stage([flight]);
    const { checkFlightReminders } = await import("../flightReminders");
    await checkFlightReminders(new Date());

    expect(mockSendFlightReminder).toHaveBeenCalledTimes(1);
    expect(mockNotifyReminder).toHaveBeenCalledTimes(2);
  });
});
