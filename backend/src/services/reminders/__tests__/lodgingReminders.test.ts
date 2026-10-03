import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFindMany = jest.fn();
jest.mock("../../../db", () => ({
  prisma: { lodgingStay: { findMany: mockFindMany } },
}));

const ENABLED = ["flight", "lodging"];

const mockSendLodgingCheckInReminder = jest.fn();
jest.mock("../../emailService", () => ({
  sendLodgingCheckInReminder: mockSendLodgingCheckInReminder,
}));

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

interface StayFixture {
  lodgingId: string;
  id: string;
  tripId: string | null;
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDate: Date | null;
  checkOutDate: Date | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  stayZone: string | null;
  datePrecision: string;
  roomNumber: string | null;
  roomCategory: string | null;
  lodging: { name: string; city: string | null; country: string | null };
  user: {
    notificationEmail: string | null;
    notifyBefore24h: boolean;
    notifyBefore2h: boolean;
    settings: { data: unknown; enabledDomains: string[] } | null;
  };
}

/**
 * A stay whose check-in day, read in `zone`, is "today" — i.e. `now`'s
 * `localDay` in that zone equals the stay's `checkInDate`'s `localDay` in
 * the same zone. Callers pass `now` explicitly (the module never reads the
 * clock itself), so a fixture only has to agree with whatever `now` the test
 * passes to `checkLodgingCheckInReminders`.
 */
function makeStay(
  overrides: Partial<StayFixture> = {},
  checkInDate = new Date("2026-09-27T00:00:00.000Z") // a `@db.Date` value must be UTC-midnight
): StayFixture {
  return {
    id: "stay-a",
    lodgingId: "lodging-a",
    tripId: null,
    checkIn: checkInDate,
    checkOut: null,
    checkInDate,
    checkOutDate: null,
    checkInAt: null,
    checkOutAt: null,
    stayZone: "Asia/Tokyo",
    datePrecision: "DAY",
    roomNumber: "204",
    roomCategory: "Double",
    lodging: { name: "Hotel Test", city: "Tokyo", country: "Japan" },
    user: {
      notificationEmail: "user@example.com",
      notifyBefore24h: true,
      notifyBefore2h: true,
      settings: { data: { display: { language: "de" } }, enabledDomains: ENABLED },
    },
    ...overrides,
  };
}

// 08:00 JST (the fixed morning window) on the stay's check-in day, as UTC.
// JST is UTC+9, so 08:00 JST on day D is 23:00 UTC on day D-1.
function morningInstant(checkInDate: Date): Date {
  const iso = checkInDate.toISOString().slice(0, 10); // YYYY-MM-DD
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) - 1 * 60 * 60 * 1000);
}

describe("checkLodgingCheckInReminders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockFindMany.mockResolvedValue([]);
  });

  it("skips a stay with no check-in day/zone precision (abstention, not a guessed time)", async () => {
    mockFindMany.mockResolvedValueOnce([makeStay({ datePrecision: "MONTH" })]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    // 08:00 UTC, arbitrary — precision alone should already exclude this stay.
    await checkLodgingCheckInReminders(new Date("2026-09-27T08:00:00.000Z"));

    expect(mockSendLodgingCheckInReminder).not.toHaveBeenCalled();
  });

  it("skips a stay whose check-in day is not today in the property's zone", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    mockFindMany.mockResolvedValueOnce([makeStay({}, checkInDate)]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    // A day AFTER check-in, at the fixed morning hour.
    await checkLodgingCheckInReminders(new Date("2026-09-27T23:00:00.000Z")); // 2026-09-28 08:00 JST

    expect(mockSendLodgingCheckInReminder).not.toHaveBeenCalled();
  });

  it("skips a stay on its check-in day outside the fixed morning hour", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    mockFindMany.mockResolvedValueOnce([makeStay({}, checkInDate)]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    // Noon JST on check-in day — same day, wrong hour.
    await checkLodgingCheckInReminders(new Date("2026-09-27T03:00:00.000Z"));

    expect(mockSendLodgingCheckInReminder).not.toHaveBeenCalled();
  });

  it("sends the reminder once, at 08:00 in the property's zone, on the check-in day", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    mockFindMany.mockResolvedValueOnce([makeStay({}, checkInDate)]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    // 08:00 JST on the check-in day == 2026-09-26T23:00:00Z.
    await checkLodgingCheckInReminders(morningInstant(checkInDate));

    expect(mockSendLodgingCheckInReminder).toHaveBeenCalledTimes(1);
    const [stayData] = mockSendLodgingCheckInReminder.mock.calls[0];
    expect(stayData.checkInDay.date).toBe("2026-09-27");
  });

  it("does not re-send the same stay on a second tick within the morning window (dedupe)", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    const stay = makeStay({}, checkInDate);
    mockFindMany.mockResolvedValueOnce([stay]);
    mockFindMany.mockResolvedValueOnce([stay]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    const now = morningInstant(checkInDate);
    await checkLodgingCheckInReminders(now);
    await checkLodgingCheckInReminders(new Date(now.getTime() + 10 * 60 * 1000));

    expect(mockSendLodgingCheckInReminder).toHaveBeenCalledTimes(1);
  });

  it("skips a stay when the user opted out (no lodging-specific flag, reuses notifyBefore24h)", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    mockFindMany.mockResolvedValueOnce([
      makeStay(
        {
          user: {
            notificationEmail: "user@example.com",
            notifyBefore24h: false,
            notifyBefore2h: true,
            settings: { data: {}, enabledDomains: ENABLED },
          },
        },
        checkInDate
      ),
    ]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    await checkLodgingCheckInReminders(morningInstant(checkInDate));

    expect(mockSendLodgingCheckInReminder).not.toHaveBeenCalled();
  });

  it("sends nothing for a stay whose user has the lodging domain switched off", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    mockFindMany.mockResolvedValueOnce([
      makeStay(
        {
          user: {
            notificationEmail: "user@example.com",
            notifyBefore24h: true,
            notifyBefore2h: true,
            settings: { data: {}, enabledDomains: ["flight"] },
          },
        },
        checkInDate
      ),
    ]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    await checkLodgingCheckInReminders(morningInstant(checkInDate));

    expect(mockSendLodgingCheckInReminder).not.toHaveBeenCalled();
  });

  it("counts the nights from the two days when both are known", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    const checkOutDate = new Date("2026-09-30T00:00:00.000Z");
    mockFindMany.mockResolvedValueOnce([
      makeStay({ checkOut: checkOutDate, checkOutDate }, checkInDate),
    ]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    await checkLodgingCheckInReminders(morningInstant(checkInDate));

    const [stay] = mockSendLodgingCheckInReminder.mock.calls[0] as [Record<string, unknown>];
    expect(stay.nights).toBe(3);
    expect(stay.checkOutDay).toEqual({ date: "2026-09-30", zone: "Asia/Tokyo", precision: "day" });
  });

  it("leaves the nights unknown — not zero — when the stay has no check-out day", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    mockFindMany.mockResolvedValueOnce([makeStay({}, checkInDate)]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    await checkLodgingCheckInReminders(morningInstant(checkInDate));

    const [stay] = mockSendLodgingCheckInReminder.mock.calls[0] as [Record<string, unknown>];
    expect(stay.nights ?? null).toBeNull();
    expect(stay.checkOutDay).toBeNull();
  });
});
