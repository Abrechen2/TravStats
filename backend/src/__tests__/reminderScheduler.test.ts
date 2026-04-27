import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockFindMany = jest.fn();
jest.mock("../db", () => ({
  prisma: {
    flight: { findMany: mockFindMany },
  },
}));

const mockSendFlightReminder = jest.fn();
jest.mock("../services/emailService", () => ({
  sendFlightReminder: mockSendFlightReminder,
}));

// Scheduler short-circuits airportCache for canonical-UTC rows, but we still
// mock it so any incidental lookup resolves cleanly during the test.
const mockGetCachedAirport = jest.fn();
jest.mock("../services/airportCache", () => ({
  getCachedAirport: mockGetCachedAirport,
}));

const mockScheduleTask = { start: jest.fn(), stop: jest.fn() };
const mockCronSchedule = jest.fn(() => mockScheduleTask);
jest.mock("node-cron", () => ({
  __esModule: true,
  default: { schedule: mockCronSchedule },
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

interface FlightFixture {
  id: string;
  flightNumber: string | null;
  depName: string | null;
  depIata: string | null;
  depIcao: string | null;
  arrName: string | null;
  arrIata: string | null;
  departureTime: Date | null;
  depTimeSemantics: string;
  userId: string;
  user: {
    notificationEmail: string | null;
    notifyBefore24h: boolean;
    notifyBefore2h: boolean;
  };
}

// Build a fixture whose departureTime falls inside the precise reminder
// window (now + hoursAhead ± 15 min) so the scheduler's in-process check
// accepts it. depTimeSemantics='UTC' lets the scheduler skip airport lookup.
function makeFlight(
  overrides: Partial<FlightFixture> = {},
  hoursAhead = 24,
): FlightFixture {
  const departureTime = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  return {
    id: "flight-a",
    flightNumber: "LH100",
    depName: "Munich",
    depIata: "MUC",
    depIcao: "EDDM",
    arrName: "Frankfurt",
    arrIata: "FRA",
    departureTime,
    depTimeSemantics: "UTC",
    userId: "user-1",
    user: {
      notificationEmail: "user@example.com",
      notifyBefore24h: true,
      notifyBefore2h: true,
    },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("reminderScheduler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockFindMany.mockResolvedValue([]);
  });

  describe("startReminderScheduler", () => {
    it("schedules a cron job every 15 minutes", async () => {
      const { startReminderScheduler, stopReminderScheduler } = await import(
        "../services/reminderScheduler"
      );

      startReminderScheduler();

      expect(mockCronSchedule).toHaveBeenCalledTimes(1);
      expect(mockCronSchedule.mock.calls[0][0]).toBe("*/15 * * * *");

      stopReminderScheduler();
    });

    it("does not start twice when called repeatedly", async () => {
      const { startReminderScheduler, stopReminderScheduler } = await import(
        "../services/reminderScheduler"
      );

      startReminderScheduler();
      startReminderScheduler();

      expect(mockCronSchedule).toHaveBeenCalledTimes(1);

      stopReminderScheduler();
    });
  });

  describe("reminder delivery (tick handler)", () => {
    // Capture the tick handler that startReminderScheduler registers with node-cron,
    // then invoke it directly to exercise the whole query + send logic.
    async function runOneTick(): Promise<void> {
      const { startReminderScheduler, stopReminderScheduler } = await import(
        "../services/reminderScheduler"
      );
      startReminderScheduler();

      const handler = mockCronSchedule.mock.calls[0][1] as () => Promise<void>;
      await handler();
      // Give async chain a chance to settle
      await Promise.resolve();

      stopReminderScheduler();
    }

    it("skips flights whose user has no notificationEmail", async () => {
      mockFindMany.mockResolvedValue([
        makeFlight({
          user: {
            notificationEmail: null,
            notifyBefore24h: true,
            notifyBefore2h: true,
          },
        }),
      ]);

      await runOneTick();

      expect(mockSendFlightReminder).not.toHaveBeenCalled();
    });

    it("skips flights when the user opted out of 24h reminders (24h window only)", async () => {
      // The scheduler queries twice (24h + 2h). Return one flight with notifyBefore24h=false
      // on the 24h query, empty on the 2h query.
      mockFindMany.mockResolvedValueOnce([
        makeFlight({
          user: {
            notificationEmail: "u@example.com",
            notifyBefore24h: false,
            notifyBefore2h: true,
          },
        }),
      ]);
      mockFindMany.mockResolvedValueOnce([]);

      await runOneTick();

      expect(mockSendFlightReminder).not.toHaveBeenCalled();
    });

    it("sends reminder when user has email and opted in", async () => {
      const flight = makeFlight();
      mockFindMany.mockResolvedValueOnce([flight]); // 24h
      mockFindMany.mockResolvedValueOnce([]); // 2h

      await runOneTick();

      expect(mockSendFlightReminder).toHaveBeenCalledTimes(1);
      const [, , hoursAhead] = mockSendFlightReminder.mock.calls[0];
      expect(hoursAhead).toBe(24);
    });

    it("does not re-send the same reminder on subsequent ticks (dedupe by flight+window)", async () => {
      const flight = makeFlight();
      // Tick 1: 24h finds flight, 2h empty
      mockFindMany.mockResolvedValueOnce([flight]);
      mockFindMany.mockResolvedValueOnce([]);
      // Tick 2: 24h finds same flight again, 2h empty
      mockFindMany.mockResolvedValueOnce([flight]);
      mockFindMany.mockResolvedValueOnce([]);
      mockSendFlightReminder.mockResolvedValue(undefined);

      const { startReminderScheduler, stopReminderScheduler } = await import(
        "../services/reminderScheduler"
      );
      startReminderScheduler();
      const handler = mockCronSchedule.mock.calls[0][1] as () => Promise<void>;

      await handler();
      await handler();

      expect(mockSendFlightReminder).toHaveBeenCalledTimes(1);
      stopReminderScheduler();
    });

    it("continues processing other windows when one Prisma query throws", async () => {
      mockFindMany.mockRejectedValueOnce(new Error("DB hiccup")); // 24h
      mockFindMany.mockResolvedValueOnce([makeFlight({ id: "flight-2h" }, 2)]); // 2h

      await runOneTick();

      // 2h window flight still got its reminder
      expect(mockSendFlightReminder).toHaveBeenCalledTimes(1);
      const [, , hoursAhead] = mockSendFlightReminder.mock.calls[0];
      expect(hoursAhead).toBe(2);
    });

    it("normalises a LEGACY_FAKE_UTC departure via airport tz before window check", async () => {
      // Wall-clock 14:00 in 'Europe/Berlin' (UTC+1 in January) → real UTC 13:00.
      // Anchor "now" so real UTC 13:00 is exactly 24h away.
      const fakeUtcWallClock = new Date("2026-01-15T14:00:00.000Z");
      const realDeparture = new Date("2026-01-15T13:00:00.000Z");
      jest.useFakeTimers({ now: realDeparture.getTime() - 24 * 60 * 60 * 1000 });

      mockGetCachedAirport.mockResolvedValueOnce({ iata: "MUC", timezone: "Europe/Berlin" });
      mockFindMany.mockResolvedValueOnce([
        makeFlight({
          id: "legacy",
          departureTime: fakeUtcWallClock,
          depTimeSemantics: "LEGACY_FAKE_UTC",
        }),
      ]);
      mockFindMany.mockResolvedValueOnce([]); // 2h

      await runOneTick();

      expect(mockSendFlightReminder).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });
  });
});
