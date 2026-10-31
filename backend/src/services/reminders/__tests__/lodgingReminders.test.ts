import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFindMany = jest.fn<() => Promise<StayFixture[]>>();
jest.mock("../../../db", () => ({
  prisma: { lodgingStay: { findMany: mockFindMany } },
}));

const ENABLED = ["flight", "lodging"];

const mockSendLodgingCheckInReminder =
  jest.fn<typeof import("../../emailService").sendLodgingCheckInReminder>();
jest.mock("../../emailService", () => ({
  sendLodgingCheckInReminder: mockSendLodgingCheckInReminder,
}));

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// The durable claim, the last-moment recheck and the push are covered by their
// own suites; here every send is claimed, still eligible, and pushed nowhere.
jest.mock("../claims", () => {
  // In-memory twin of the durable claim: one owner per key, freed on release.
  const claimed = new Set<string>();
  return {
    claimReminder: jest.fn(async (key: unknown) => {
      const id = JSON.stringify(key);
      if (claimed.has(id)) return null;
      claimed.add(id);
      return { id };
    }),
    markSent: jest.fn(async () => undefined),
    releaseClaim: jest.fn(async (claim: { id: string }) => {
      claimed.delete(claim.id);
    }),
  };
});
jest.mock("../eligibility", () => ({
  ...jest.requireActual<typeof import("../eligibility")>("../eligibility"),
  stillEligible: jest.fn(async () => true),
}));
jest.mock("../../notifications/dispatcher", () => ({
  notifyEntryReminder: jest.fn(async () => undefined),
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

// The reminder instant for the default anchor: 15:00 JST (UTC+9) on the check-in
// day is 06:00Z, and the 24 h lead makes it due at 06:00Z the day before.
function dueInstant(checkInDate: Date): Date {
  const iso = checkInDate.toISOString().slice(0, 10); // YYYY-MM-DD
  return new Date(Date.parse(`${iso}T06:00:00.000Z`) - 24 * 60 * 60 * 1000);
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

  it("sends nothing before the lead has begun, nor more than an hour late, nor after check-in", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    const due = dueInstant(checkInDate);
    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    for (const now of [
      new Date(due.getTime() - 60 * 1000), // one minute early
      new Date(due.getTime() + 61 * 60 * 1000), // an hour and a minute late
    ]) {
      mockFindMany.mockResolvedValueOnce([makeStay({}, checkInDate)]);
      await checkLodgingCheckInReminders(now);
    }
    expect(mockSendLodgingCheckInReminder).not.toHaveBeenCalled();
  });

  it("still sends a reminder that is at most an hour late (a missed cron run)", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    mockFindMany.mockResolvedValueOnce([makeStay({}, checkInDate)]);
    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    await checkLodgingCheckInReminders(
      new Date(dueInstant(checkInDate).getTime() + 45 * 60 * 1000)
    );
    expect(mockSendLodgingCheckInReminder).toHaveBeenCalledTimes(1);
  });

  it("sends the reminder once, 24 h before the default 15:00 check-in in the property's zone", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    mockFindMany.mockResolvedValueOnce([makeStay({}, checkInDate)]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    // 08:00 JST on the check-in day == 2026-09-26T23:00:00Z.
    await checkLodgingCheckInReminders(dueInstant(checkInDate));

    expect(mockSendLodgingCheckInReminder).toHaveBeenCalledTimes(1);
    const [stayData] = mockSendLodgingCheckInReminder.mock.calls[0];
    expect(stayData.checkInDay.date).toBe("2026-09-27");
  });

  it("does not re-send the same stay on a second tick within the window (dedupe)", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    const stay = makeStay({}, checkInDate);
    mockFindMany.mockResolvedValueOnce([stay]);
    mockFindMany.mockResolvedValueOnce([stay]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    const now = dueInstant(checkInDate);
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
    await checkLodgingCheckInReminders(dueInstant(checkInDate));

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
    await checkLodgingCheckInReminders(dueInstant(checkInDate));

    expect(mockSendLodgingCheckInReminder).not.toHaveBeenCalled();
  });

  it("counts the nights from the two days when both are known", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    const checkOutDate = new Date("2026-09-30T00:00:00.000Z");
    mockFindMany.mockResolvedValueOnce([
      makeStay({ checkOut: checkOutDate, checkOutDate }, checkInDate),
    ]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    await checkLodgingCheckInReminders(dueInstant(checkInDate));

    const [stay] = mockSendLodgingCheckInReminder.mock.calls[0];
    expect(stay.nights).toBe(3);
    expect(stay.checkOutDay).toEqual({ date: "2026-09-30", zone: "Asia/Tokyo", precision: "day" });
  });

  it("leaves the nights unknown — not zero — when the stay has no check-out day", async () => {
    const checkInDate = new Date("2026-09-27T00:00:00.000Z");
    mockFindMany.mockResolvedValueOnce([makeStay({}, checkInDate)]);

    const { checkLodgingCheckInReminders } = await import("../lodgingReminders");
    await checkLodgingCheckInReminders(dueInstant(checkInDate));

    const [stay] = mockSendLodgingCheckInReminder.mock.calls[0];
    expect(stay.nights ?? null).toBeNull();
    expect(stay.checkOutDay).toBeNull();
  });
});

describe("lodgingAnchor — the check-in instant", () => {
  const base = {
    checkIn: new Date("2026-09-27T00:00:00.000Z"),
    checkOut: null,
    checkInDate: new Date("2026-09-27T00:00:00.000Z"),
    checkOutDate: null,
    checkInAt: null,
    checkOutAt: null,
    stayZone: "Asia/Tokyo",
    datePrecision: "DAY",
    freeCancellationUntil: null,
    freeCancellationOn: null,
    freeCancellationZone: null,
    paymentDueOn: null,
  };

  it("uses the stored check-in time when the stay has one and a zone", async () => {
    const { lodgingAnchor } = await import("../lodgingReminders");
    const at = new Date("2026-09-27T09:30:00.000Z");
    expect(lodgingAnchor({ ...base, checkInAt: at }, "America/New_York")?.anchor).toEqual(at);
  });

  it("falls back to 15:00 in the STAY's zone when only the day is known", async () => {
    const { lodgingAnchor } = await import("../lodgingReminders");
    expect(lodgingAnchor(base, "America/New_York")?.anchor.toISOString()).toBe(
      "2026-09-27T06:00:00.000Z"
    );
  });

  it("falls back to 15:00 in the ACCOUNT's zone when the stay has no zone", async () => {
    const { lodgingAnchor } = await import("../lodgingReminders");
    const anchor = lodgingAnchor({ ...base, stayZone: null }, "America/New_York")?.anchor;
    expect(anchor?.toISOString()).toBe("2026-09-27T19:00:00.000Z"); // 15:00 EDT
  });

  it("abstains for a stay without a check-in day", async () => {
    const { lodgingAnchor } = await import("../lodgingReminders");
    expect(lodgingAnchor({ ...base, datePrecision: "MONTH" }, "UTC")).toBeNull();
  });
});
