import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFindMany =
  jest.fn<
    (args: import("../../../prisma").Prisma.BusJourneyFindManyArgs) => Promise<RideFixture[]>
  >();
jest.mock("../../../db", () => ({
  prisma: { busJourney: { findMany: mockFindMany } },
}));

const mockGetInstanceSettings = jest.fn<() => Promise<{ betaFeaturesEnabled: boolean }>>();
jest.mock("../../instanceSettingsService", () => ({
  getInstanceSettings: mockGetInstanceSettings,
}));

const mockSendBusReminder = jest.fn<typeof import("../../emailService").sendBusReminder>();
jest.mock("../../emailService", () => ({
  sendBusReminder: mockSendBusReminder,
}));

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const ENABLED = ["flight", "bus"];

interface RideFixture {
  id: string;
  tripId: string | null;
  operator: string | null;
  lineName: string | null;
  fareClass: string | null;
  seat: string | null;
  bookingReference: string | null;
  depStationName: string;
  arrStationName: string;
  departureTime: Date;
  arrivalTime: Date | null;
  actualDepartureTime: Date | null;
  actualArrivalTime: Date | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  depPrecision: string | null;
  arrPrecision: string | null;
  user: {
    notificationEmail: string | null;
    notifyBefore24h: boolean;
    notifyBefore2h: boolean;
    settings: { data: unknown; enabledDomains: string[] } | null;
  };
}

const USER: RideFixture["user"] = {
  notificationEmail: "user@example.com",
  notifyBefore24h: true,
  notifyBefore2h: true,
  settings: { data: { display: { language: "de" } }, enabledDomains: ENABLED },
};

function makeRide(overrides: Partial<RideFixture> = {}, hoursAhead = 24): RideFixture {
  const departureTime = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  return {
    id: "ride-a",
    tripId: null,
    operator: "FlixBus",
    lineName: "N17",
    fareClass: null,
    seat: "12A",
    bookingReference: "FLX123",
    depStationName: "München ZOB",
    arrStationName: "Prag ÚAN Florenc",
    departureTime,
    arrivalTime: new Date(departureTime.getTime() + 5 * 60 * 60 * 1000),
    actualDepartureTime: null,
    actualArrivalTime: null,
    // Fixed zones that never observe DST, so the resolved local clocks are
    // deterministic across the year — and differ from each other and from UTC.
    depTimezone: "Asia/Tokyo",
    arrTimezone: "Asia/Kolkata",
    depPrecision: "minute",
    arrPrecision: "minute",
    user: USER,
    ...overrides,
  };
}

/** The window query, answered the way Postgres would from these rows. */
function serve(rows: RideFixture[]): void {
  mockFindMany.mockImplementation(async (args) => {
    const where = args.where as { departureTime: { gte: Date; lte: Date } };
    return rows.filter(
      (row) =>
        row.departureTime >= where.departureTime.gte &&
        row.departureTime <= where.departureTime.lte &&
        row.depPrecision !== "day" &&
        row.depPrecision !== "unknown"
    );
  });
}

describe("checkBusReminders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockFindMany.mockResolvedValue([]);
    mockGetInstanceSettings.mockResolvedValue({ betaFeaturesEnabled: true });
  });

  it("sends a ride inside the 24h window, both terminals on their own clock", async () => {
    const ride = makeRide();
    serve([ride]);

    const { checkBusReminders } = await import("../busReminders");
    await checkBusReminders(new Date());

    expect(mockSendBusReminder).toHaveBeenCalledTimes(1);
    const [data, user, hoursAhead] = mockSendBusReminder.mock.calls[0];
    expect(hoursAhead).toBe(24);
    expect(user.notificationEmail).toBe("user@example.com");
    expect(data.departure.zone).toBe("Asia/Tokyo");
    expect(data.arrival!.zone).toBe("Asia/Kolkata");
    // Tokyo is UTC+9 all year: the local clock is the instant plus nine hours.
    const tokyo = new Date(ride.departureTime.getTime() + 9 * 60 * 60 * 1000);
    expect(data.departure.local.slice(0, 16)).toBe(tokyo.toISOString().slice(0, 16));
    expect(data.lineName).toBe("N17");
    expect(data.bookingReference).toBe("FLX123");
  });

  it("does not send the same ride twice in one window (dedupe)", async () => {
    serve([makeRide()]);

    const { checkBusReminders } = await import("../busReminders");
    const now = new Date();
    await checkBusReminders(now);
    await checkBusReminders(new Date(now.getTime() + 5 * 60 * 1000));

    expect(mockSendBusReminder).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a user who has the bus domain switched off", async () => {
    serve([makeRide({ user: { ...USER, settings: { data: {}, enabledDomains: ["flight"] } } })]);

    const { checkBusReminders } = await import("../busReminders");
    await checkBusReminders(new Date());

    expect(mockSendBusReminder).not.toHaveBeenCalled();
  });

  it("sends nothing, and asks for nothing, on an instance that hides the beta domains", async () => {
    mockGetInstanceSettings.mockResolvedValue({ betaFeaturesEnabled: false });
    serve([makeRide()]);

    const { checkBusReminders } = await import("../busReminders");
    await checkBusReminders(new Date());

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockSendBusReminder).not.toHaveBeenCalled();
  });

  it("sends nothing when the instance's beta switch cannot be read", async () => {
    mockGetInstanceSettings.mockRejectedValue(new Error("DB hiccup"));
    serve([makeRide()]);

    const { checkBusReminders } = await import("../busReminders");
    await checkBusReminders(new Date());

    expect(mockSendBusReminder).not.toHaveBeenCalled();
  });

  it("skips a ride whose user has no notificationEmail", async () => {
    serve([makeRide({ user: { ...USER, notificationEmail: null } })]);

    const { checkBusReminders } = await import("../busReminders");
    await checkBusReminders(new Date());

    expect(mockSendBusReminder).not.toHaveBeenCalled();
  });

  it("skips a ride when the user opted out of the matching window", async () => {
    serve([makeRide({ user: { ...USER, notifyBefore24h: false } })]);

    const { checkBusReminders } = await import("../busReminders");
    await checkBusReminders(new Date());

    expect(mockSendBusReminder).not.toHaveBeenCalled();
  });

  it("continues with the 2h window when the 24h query throws", async () => {
    mockFindMany.mockRejectedValueOnce(new Error("DB hiccup"));
    mockFindMany.mockResolvedValueOnce([makeRide({ id: "ride-2h" }, 2)]);

    const { checkBusReminders } = await import("../busReminders");
    await checkBusReminders(new Date());

    expect(mockSendBusReminder).toHaveBeenCalledTimes(1);
    expect(mockSendBusReminder.mock.calls[0][2]).toBe(2);
  });

  // forgejo#132 item 17, as for rail: a date-only departure is stored at the
  // start of its day, so "leaves in 2 hours" would be a time nobody printed.
  it("asks only for scheduled rides whose departure carries a clock", async () => {
    const { checkBusReminders } = await import("../busReminders");
    await checkBusReminders(new Date());

    expect(mockFindMany).toHaveBeenCalledTimes(2);
    for (const [args] of mockFindMany.mock.calls) {
      const where = args.where as Record<string, unknown>;
      expect(where.status).toBe("scheduled");
      expect(where.OR).toEqual([
        { depPrecision: null },
        { depPrecision: { notIn: ["day", "unknown"] } },
      ]);
    }
  });
});
