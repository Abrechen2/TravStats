import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFindMany =
  jest.fn<
    (args: import("../../../prisma").Prisma.FerryJourneyFindManyArgs) => Promise<CrossingFixture[]>
  >();
jest.mock("../../../db", () => ({
  prisma: { ferryJourney: { findMany: mockFindMany } },
}));

const mockGetInstanceSettings = jest.fn<() => Promise<{ betaFeaturesEnabled: boolean }>>();
jest.mock("../../instanceSettingsService", () => ({
  getInstanceSettings: mockGetInstanceSettings,
}));

const mockSendFerryReminder = jest.fn<typeof import("../../emailService").sendFerryReminder>();
jest.mock("../../emailService", () => ({
  sendFerryReminder: mockSendFerryReminder,
}));

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const ENABLED = ["flight", "ferry"];

interface CrossingFixture {
  id: string;
  tripId: string | null;
  operator: string | null;
  vesselName: string | null;
  fareClass: string | null;
  cabinType: string | null;
  seat: string | null;
  vehicleType: string | null;
  vehicleRegistration: string | null;
  bookingReference: string | null;
  ticketReference: string | null;
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

const USER: CrossingFixture["user"] = {
  notificationEmail: "user@example.com",
  notifyBefore24h: true,
  notifyBefore2h: true,
  settings: { data: { display: { language: "de" } }, enabledDomains: ENABLED },
};

function makeCrossing(overrides: Partial<CrossingFixture> = {}, hoursAhead = 24): CrossingFixture {
  const departureTime = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  return {
    id: "crossing-a",
    tripId: null,
    operator: "Stena Line",
    vesselName: "Stena Germanica",
    fareClass: null,
    cabinType: "Inside",
    seat: null,
    vehicleType: "car",
    vehicleRegistration: "KI-AB 123",
    bookingReference: "STN123",
    ticketReference: null,
    depStationName: "Kiel",
    arrStationName: "Göteborg",
    departureTime,
    arrivalTime: new Date(departureTime.getTime() + 14 * 60 * 60 * 1000),
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
function serve(rows: CrossingFixture[]): void {
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

describe("checkFerryReminders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockFindMany.mockResolvedValue([]);
    mockGetInstanceSettings.mockResolvedValue({ betaFeaturesEnabled: true });
  });

  it("sends a crossing inside the 24h window, both ports on their own clock", async () => {
    const crossing = makeCrossing();
    serve([crossing]);

    const { checkFerryReminders } = await import("../ferryReminders");
    await checkFerryReminders(new Date());

    expect(mockSendFerryReminder).toHaveBeenCalledTimes(1);
    const [data, user, hoursAhead] = mockSendFerryReminder.mock.calls[0];
    expect(hoursAhead).toBe(24);
    expect(user.notificationEmail).toBe("user@example.com");
    expect(data.departure.zone).toBe("Asia/Tokyo");
    expect(data.arrival!.zone).toBe("Asia/Kolkata");
    // Tokyo is UTC+9 all year: the local clock is the instant plus nine hours.
    const tokyo = new Date(crossing.departureTime.getTime() + 9 * 60 * 60 * 1000);
    expect(data.departure.local.slice(0, 16)).toBe(tokyo.toISOString().slice(0, 16));
    expect(data.vesselName).toBe("Stena Germanica");
    expect(data.bookingReference).toBe("STN123");
  });

  it("does not send the same crossing twice in one window (dedupe)", async () => {
    serve([makeCrossing()]);

    const { checkFerryReminders } = await import("../ferryReminders");
    const now = new Date();
    await checkFerryReminders(now);
    await checkFerryReminders(new Date(now.getTime() + 5 * 60 * 1000));

    expect(mockSendFerryReminder).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a user who has the ferry domain switched off", async () => {
    serve([
      makeCrossing({ user: { ...USER, settings: { data: {}, enabledDomains: ["flight"] } } }),
    ]);

    const { checkFerryReminders } = await import("../ferryReminders");
    await checkFerryReminders(new Date());

    expect(mockSendFerryReminder).not.toHaveBeenCalled();
  });

  // Out of beta on 2026-10-26: the instance's switch no longer holds a mail back.
  it("sends with the instance's beta switch off, the user's domain on", async () => {
    mockGetInstanceSettings.mockResolvedValue({ betaFeaturesEnabled: false });
    serve([makeCrossing()]);

    const { checkFerryReminders } = await import("../ferryReminders");
    await checkFerryReminders(new Date());

    expect(mockSendFerryReminder).toHaveBeenCalledTimes(1);
  });

  it("skips a crossing whose user has no notificationEmail", async () => {
    serve([makeCrossing({ user: { ...USER, notificationEmail: null } })]);

    const { checkFerryReminders } = await import("../ferryReminders");
    await checkFerryReminders(new Date());

    expect(mockSendFerryReminder).not.toHaveBeenCalled();
  });

  it("skips a crossing when the user opted out of the matching window", async () => {
    serve([makeCrossing({ user: { ...USER, notifyBefore24h: false } })]);

    const { checkFerryReminders } = await import("../ferryReminders");
    await checkFerryReminders(new Date());

    expect(mockSendFerryReminder).not.toHaveBeenCalled();
  });

  it("continues with the 2h window when the 24h query throws", async () => {
    mockFindMany.mockRejectedValueOnce(new Error("DB hiccup"));
    mockFindMany.mockResolvedValueOnce([makeCrossing({ id: "crossing-2h" }, 2)]);

    const { checkFerryReminders } = await import("../ferryReminders");
    await checkFerryReminders(new Date());

    expect(mockSendFerryReminder).toHaveBeenCalledTimes(1);
    expect(mockSendFerryReminder.mock.calls[0][2]).toBe(2);
  });

  // forgejo#132 item 17, as for rail: a date-only departure is stored at the
  // start of its day, so "leaves in 2 hours" would be a time nobody printed.
  it("asks only for scheduled crossings whose departure carries a clock", async () => {
    const { checkFerryReminders } = await import("../ferryReminders");
    await checkFerryReminders(new Date());

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
