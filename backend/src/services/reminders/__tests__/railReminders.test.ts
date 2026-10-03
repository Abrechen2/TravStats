import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFindMany = jest.fn();
jest.mock("../../../db", () => ({
  prisma: { railJourney: { findMany: mockFindMany } },
}));

const ENABLED = ["flight", "rail"];

const mockSendRailReminder = jest.fn();
jest.mock("../../emailService", () => ({
  sendRailReminder: mockSendRailReminder,
}));

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

interface JourneyFixture {
  id: string;
  tripId: string | null;
  operator: string | null;
  trainCategory: string | null;
  trainNumber: string | null;
  coach: string | null;
  seat: string | null;
  depStationName: string;
  depTimezone: string | null;
  depPrecision: string | null;
  arrStationName: string;
  arrTimezone: string | null;
  arrPrecision: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  userId: string;
  user: {
    notificationEmail: string | null;
    notifyBefore24h: boolean;
    notifyBefore2h: boolean;
    settings: { data: unknown; enabledDomains: string[] } | null;
  };
}

function makeJourney(overrides: Partial<JourneyFixture> = {}, hoursAhead = 24): JourneyFixture {
  // RailJourney.departureTime is ALREADY a real UTC instant (no LEGACY class) —
  // unlike the flight fixture there is no wall-clock/semantics ambiguity to model.
  const departureTime = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  return {
    id: "journey-a",
    tripId: null,
    operator: "DB",
    trainCategory: "ICE",
    trainNumber: "123",
    coach: "12",
    seat: "34",
    depStationName: "Berlin Hbf",
    // A real, fixed zone (never observes DST at all) so the resolved local
    // time is deterministic — unlike Europe/Berlin's offset that would drift
    // this fixture's expectations across the year.
    depTimezone: "Asia/Tokyo",
    depPrecision: "minute",
    arrStationName: "Munich Hbf",
    arrTimezone: "Europe/Berlin",
    arrPrecision: "minute",
    departureTime,
    arrivalTime: new Date(departureTime.getTime() + 4 * 60 * 60 * 1000),
    userId: "user-1",
    user: {
      notificationEmail: "user@example.com",
      notifyBefore24h: true,
      notifyBefore2h: true,
      settings: { data: { display: { language: "de" } }, enabledDomains: ENABLED },
    },
    ...overrides,
  };
}

describe("checkRailReminders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockFindMany.mockResolvedValue([]);
  });

  it("skips a journey whose user has no notificationEmail", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeJourney({
        user: {
          notificationEmail: null,
          notifyBefore24h: true,
          notifyBefore2h: true,
          settings: { data: {}, enabledDomains: ENABLED },
        },
      }),
    ]);
    mockFindMany.mockResolvedValueOnce([]);

    const { checkRailReminders } = await import("../railReminders");
    await checkRailReminders(new Date());

    expect(mockSendRailReminder).not.toHaveBeenCalled();
  });

  it("skips a journey when the user opted out of the matching window", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeJourney({
        user: {
          notificationEmail: "user@example.com",
          notifyBefore24h: false,
          notifyBefore2h: true,
          settings: { data: {}, enabledDomains: ENABLED },
        },
      }),
    ]);
    mockFindMany.mockResolvedValueOnce([]);

    const { checkRailReminders } = await import("../railReminders");
    await checkRailReminders(new Date());

    expect(mockSendRailReminder).not.toHaveBeenCalled();
  });

  it("sends a reminder for a journey inside the 24h window and opted in, with both stations' zones", async () => {
    mockFindMany.mockResolvedValueOnce([makeJourney()]);
    mockFindMany.mockResolvedValueOnce([]);

    const { checkRailReminders } = await import("../railReminders");
    await checkRailReminders(new Date());

    expect(mockSendRailReminder).toHaveBeenCalledTimes(1);
    const [journeyData, , hoursAhead] = mockSendRailReminder.mock.calls[0];
    expect(hoursAhead).toBe(24);
    expect(journeyData.departure.zone).toBe("Asia/Tokyo");
    expect(journeyData.arrival.zone).toBe("Europe/Berlin");
  });

  it("does not re-send the same journey+window on a second call (dedupe)", async () => {
    const journey = makeJourney();
    mockFindMany.mockResolvedValueOnce([journey]);
    mockFindMany.mockResolvedValueOnce([]);
    mockFindMany.mockResolvedValueOnce([journey]);
    mockFindMany.mockResolvedValueOnce([]);

    const { checkRailReminders } = await import("../railReminders");
    const now = new Date();
    await checkRailReminders(now);
    await checkRailReminders(now);

    expect(mockSendRailReminder).toHaveBeenCalledTimes(1);
  });

  it("continues processing the 2h window when the 24h query throws", async () => {
    mockFindMany.mockRejectedValueOnce(new Error("DB hiccup"));
    mockFindMany.mockResolvedValueOnce([makeJourney({ id: "journey-2h" }, 2)]);

    const { checkRailReminders } = await import("../railReminders");
    await checkRailReminders(new Date());

    expect(mockSendRailReminder).toHaveBeenCalledTimes(1);
    const [, , hoursAhead] = mockSendRailReminder.mock.calls[0];
    expect(hoursAhead).toBe(2);
  });

  // forgejo#132 item 17: a ride logged date-only is stored at the start of
  // its day. "Leaves in 2 hours" would announce a time nobody printed, so the
  // reminder query only reads rides whose departure carries a clock — rows
  // written before the precision column (NULL) included.
  it("asks only for rides whose departure carries a clock", async () => {
    const { checkRailReminders } = await import("../railReminders");
    await checkRailReminders(new Date());

    expect(mockFindMany).toHaveBeenCalled();
    for (const [args] of mockFindMany.mock.calls as Array<[{ where: Record<string, unknown> }]>) {
      expect(args.where.OR).toEqual([
        { depPrecision: null },
        { depPrecision: { notIn: ["day", "unknown"] } },
      ]);
    }
  });

  it("sends nothing for a journey whose user has the rail domain switched off", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeJourney({
        user: {
          notificationEmail: "user@example.com",
          notifyBefore24h: true,
          notifyBefore2h: true,
          settings: { data: {}, enabledDomains: ["flight"] },
        },
      }),
    ]);

    const { checkRailReminders } = await import("../railReminders");
    await checkRailReminders(new Date());

    expect(mockSendRailReminder).not.toHaveBeenCalled();
  });

  it("hands the mail the class and the booking reference the journey carries", async () => {
    mockFindMany.mockResolvedValueOnce([
      { ...makeJourney(), travelClass: "first", bookingReference: "ABC123" },
    ]);

    const { checkRailReminders } = await import("../railReminders");
    await checkRailReminders(new Date());

    const [journey] = mockSendRailReminder.mock.calls[0] as [Record<string, unknown>];
    expect(journey.travelClass).toBe("first");
    expect(journey.bookingReference).toBe("ABC123");
  });
});
