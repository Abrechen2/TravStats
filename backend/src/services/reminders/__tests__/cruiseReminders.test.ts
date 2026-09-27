import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFindMany = jest.fn();
jest.mock("../../../db", () => ({
  prisma: { cruiseStop: { findMany: mockFindMany } },
}));

const mockSendCruiseReminder = jest.fn();
jest.mock("../../emailService", () => ({
  sendCruiseReminder: mockSendCruiseReminder,
}));

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

interface StopFixture {
  id: string;
  departureUtc: Date | null;
  stopZone: string | null;
  timePrecision: string | null;
  port: {
    name: string;
    city: string | null;
    country: string | null;
    timezone: string | null;
    lat: number;
    lon: number;
  } | null;
  cruise: {
    id: string;
    tripId: string | null;
    cruiseLine: string | null;
    shipNameOverride: string | null;
    cabinType: string | null;
    cabinNumber: string | null;
    deck: number | null;
    ship: { name: string } | null;
    user: {
      notificationEmail: string | null;
      notifyBefore24h: boolean;
      notifyBefore2h: boolean;
      settings: { data: unknown } | null;
    };
  };
}

function makeStop(overrides: Partial<StopFixture> = {}, hoursAhead = 24): StopFixture {
  const departureUtc = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  return {
    id: "stop-a",
    departureUtc,
    stopZone: null,
    timePrecision: "minute",
    port: {
      name: "Port of Miami",
      city: "Miami",
      country: "US",
      // A real, fixed-zone coordinate (Tokyo) so `zoneOf` resolves it
      // deterministically without a stored `stopZone`.
      timezone: null,
      lat: 35.6762,
      lon: 139.6503,
    },
    cruise: {
      id: "cruise-a",
      tripId: null,
      cruiseLine: "Test Line",
      shipNameOverride: "Test Ship",
      cabinType: "Balcony",
      cabinNumber: "8102",
      deck: 8,
      ship: null,
      user: {
        notificationEmail: "user@example.com",
        notifyBefore24h: true,
        notifyBefore2h: true,
        settings: { data: { display: { language: "de" } } },
      },
    },
    ...overrides,
  };
}

describe("checkCruiseReminders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockFindMany.mockResolvedValue([]);
  });

  it("skips a stop whose cruise user has no notificationEmail", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeStop({
        cruise: {
          ...makeStop().cruise,
          user: {
            notificationEmail: null,
            notifyBefore24h: true,
            notifyBefore2h: true,
            settings: null,
          },
        },
      }),
    ]);
    mockFindMany.mockResolvedValueOnce([]);

    const { checkCruiseReminders } = await import("../cruiseReminders");
    await checkCruiseReminders(new Date());

    expect(mockSendCruiseReminder).not.toHaveBeenCalled();
  });

  it("skips a stop when the user opted out of the matching window", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeStop({
        cruise: {
          ...makeStop().cruise,
          user: {
            notificationEmail: "user@example.com",
            notifyBefore24h: false,
            notifyBefore2h: true,
            settings: null,
          },
        },
      }),
    ]);
    mockFindMany.mockResolvedValueOnce([]);

    const { checkCruiseReminders } = await import("../cruiseReminders");
    await checkCruiseReminders(new Date());

    expect(mockSendCruiseReminder).not.toHaveBeenCalled();
  });

  it("sends a reminder for a stop inside the 24h window and opted in", async () => {
    mockFindMany.mockResolvedValueOnce([makeStop()]);
    mockFindMany.mockResolvedValueOnce([]);

    const { checkCruiseReminders } = await import("../cruiseReminders");
    await checkCruiseReminders(new Date());

    expect(mockSendCruiseReminder).toHaveBeenCalledTimes(1);
    const [, , hoursAhead] = mockSendCruiseReminder.mock.calls[0];
    expect(hoursAhead).toBe(24);
  });

  it("resolves the embarkation port's zone from coordinates when no stopZone is stored", async () => {
    mockFindMany.mockResolvedValueOnce([makeStop()]);
    mockFindMany.mockResolvedValueOnce([]);

    const { checkCruiseReminders } = await import("../cruiseReminders");
    await checkCruiseReminders(new Date());

    const [cruiseData] = mockSendCruiseReminder.mock.calls[0];
    // Tokyo coordinates, no stored stopZone → resolved via geo-tz.
    expect(cruiseData.departure.zone).toBe("Asia/Tokyo");
  });

  it("does not re-send the same cruise+window on a second call (dedupe)", async () => {
    const stop = makeStop();
    mockFindMany.mockResolvedValueOnce([stop]);
    mockFindMany.mockResolvedValueOnce([]);
    mockFindMany.mockResolvedValueOnce([stop]);
    mockFindMany.mockResolvedValueOnce([]);

    const { checkCruiseReminders } = await import("../cruiseReminders");
    const now = new Date();
    await checkCruiseReminders(now);
    await checkCruiseReminders(now);

    expect(mockSendCruiseReminder).toHaveBeenCalledTimes(1);
  });

  it("does not fire for a cruise whose embarkation stop carries no departureUtc (abstention)", async () => {
    // The Prisma `where` clause already excludes null departureUtc rows, so
    // this asserts the query itself, not an in-process filter.
    mockFindMany.mockResolvedValueOnce([]);
    mockFindMany.mockResolvedValueOnce([]);

    const { checkCruiseReminders } = await import("../cruiseReminders");
    await checkCruiseReminders(new Date());

    const [{ where }] = mockFindMany.mock.calls[0];
    expect(where.departureUtc).toBeDefined();
    expect(mockSendCruiseReminder).not.toHaveBeenCalled();
  });
});
