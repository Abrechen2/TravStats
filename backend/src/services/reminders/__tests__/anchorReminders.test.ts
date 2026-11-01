import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * forgejo#405: reminders for rental pick-up/return, roadtrip stations and
 * places with a future visit. The scheduler reads rows through mocked
 * delegates; sends, claims and push are observed.
 */
const mockRentalFindMany = jest.fn<(args: unknown) => Promise<unknown[]>>();
const mockStopFindMany = jest.fn<(args: unknown) => Promise<unknown[]>>();
const mockVisitFindMany = jest.fn<(args: unknown) => Promise<unknown[]>>();
jest.mock("../../../db", () => ({
  prisma: {
    rentalBooking: { findMany: mockRentalFindMany },
    tripStop: { findMany: mockStopFindMany },
    placeVisit: { findMany: mockVisitFindMany },
  },
}));

const mockSendRental = jest.fn<typeof import("../../emailService").sendRentalReminder>();
const mockSendStation = jest.fn<typeof import("../../emailService").sendRoadtripStationReminder>();
const mockSendVisit = jest.fn<typeof import("../../emailService").sendPlaceVisitReminder>();
jest.mock("../../emailService", () => ({
  sendRentalReminder: mockSendRental,
  sendRoadtripStationReminder: mockSendStation,
  sendPlaceVisitReminder: mockSendVisit,
}));

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const claimedKeys: string[] = [];
jest.mock("../claims", () => {
  const claimed = new Set<string>();
  return {
    ...jest.requireActual<typeof import("../claims")>("../claims"),
    claimReminder: jest.fn(async (key: { entryId: string; leadHours: number }) => {
      const id = JSON.stringify(key);
      if (claimed.has(id)) return null;
      claimed.add(id);
      claimedKeys.push(`${key.entryId}@${key.leadHours}`);
      return { id };
    }),
    markSent: jest.fn(async () => undefined),
    releaseClaim: jest.fn(async () => undefined),
  };
});
jest.mock("../eligibility", () => ({
  ...jest.requireActual<typeof import("../eligibility")>("../eligibility"),
  stillEligible: jest.fn(async () => true),
}));
const mockPush = jest.fn<(userId: string, entry: Record<string, unknown>) => Promise<void>>();
jest.mock("../../notifications/dispatcher", () => ({ notifyEntryReminder: mockPush }));

const HOUR = 3_600_000;

function user(enabled: string[]) {
  return {
    id: "u1",
    notificationEmail: "user@example.com",
    notifyBefore24h: true,
    notifyBefore2h: false,
    devicePushes: [{ reminders: true }],
    settings: { data: { display: { language: "de" } }, enabledDomains: enabled },
  };
}

function rental(overrides: Record<string, unknown> = {}, now = new Date()) {
  return {
    id: "rent-1",
    status: "scheduled",
    tripId: null,
    provider: "Sixt",
    confirmationNumber: "ABC123",
    vehicleClass: "Compact",
    vehicleExample: "VW Golf or similar",
    licensePlate: null,
    pickupStationName: "Lisbon Airport",
    pickupAddress: null,
    returnStationName: "Porto Airport",
    returnAddress: null,
    pickupTime: new Date(now.getTime() + 24 * HOUR),
    returnTime: new Date(now.getTime() + 24 * HOUR),
    pickupPrecision: "minute",
    returnPrecision: "minute",
    pickupTimezone: "Europe/Lisbon",
    returnTimezone: "Europe/Lisbon",
    user: user(["flight", "rental"]),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  claimedKeys.length = 0;
  jest.resetModules();
  mockRentalFindMany.mockResolvedValue([]);
  mockStopFindMany.mockResolvedValue([]);
  mockVisitFindMany.mockResolvedValue([]);
});

describe("checkRentalReminders", () => {
  it("announces pick-up and return separately even when both fall in one window", async () => {
    const now = new Date();
    mockRentalFindMany.mockResolvedValueOnce([rental({}, now)]);
    const { checkRentalReminders } = await import("../rentalReminders");
    await checkRentalReminders(now);

    expect(mockSendRental).toHaveBeenCalledTimes(2);
    expect(mockSendRental.mock.calls.map((c) => c[0].part).sort()).toEqual(["pickup", "return"]);
    // Two claims, not one: pick-up and return must not dedupe each other.
    expect(claimedKeys.filter((k) => k.endsWith("@24")).sort()).toEqual([
      "rent-1#pickup@24",
      "rent-1#return@24",
    ]);
  });

  it("carries rentalId and the part into the push, keeping entryId the booking id", async () => {
    const now = new Date();
    mockRentalFindMany.mockResolvedValueOnce([rental({}, now)]);
    const { checkRentalReminders } = await import("../rentalReminders");
    await checkRentalReminders(now);

    const pushes = mockPush.mock.calls.map((c) => c[1]);
    expect(pushes).toHaveLength(2);
    for (const push of pushes) {
      expect(push).toMatchObject({ domain: "rental", entryId: "rent-1" });
      expect(push.extraIds).toEqual({ rentalId: "rent-1" });
    }
    expect(pushes.map((p) => p.part).sort()).toEqual(["pickup", "return"]);
  });

  it("still announces the return of a car that is already picked up (in_progress)", async () => {
    const now = new Date();
    mockRentalFindMany.mockResolvedValueOnce([rental({ status: "in_progress" }, now)]);
    const { checkRentalReminders } = await import("../rentalReminders");
    await checkRentalReminders(now);

    expect(mockSendRental).toHaveBeenCalledTimes(1);
    expect(mockSendRental.mock.calls[0][0].part).toBe("return");
    // ... and the query asks for it: an in_progress rental is read for its return only.
    const where = (mockRentalFindMany.mock.calls[0][0] as { where: { OR: unknown[] } }).where;
    expect(JSON.stringify(where.OR)).toContain('"status":{"in":["scheduled","in_progress"]}');
  });

  it("abstains for a hand-over known only to the day, announcing the other one", async () => {
    const now = new Date();
    mockRentalFindMany.mockResolvedValueOnce([rental({ pickupPrecision: "day" }, now)]);
    const { checkRentalReminders } = await import("../rentalReminders");
    await checkRentalReminders(now);

    expect(mockSendRental).toHaveBeenCalledTimes(1);
    expect(mockSendRental.mock.calls[0][0].part).toBe("return");
  });

  it("asks only for rentals whose anchor still lies ahead and carries a clock", async () => {
    const { checkRentalReminders } = await import("../rentalReminders");
    await checkRentalReminders(new Date());
    const where = (mockRentalFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    // Pick-up needs a scheduled rental; the return also reads one already picked up.
    expect(JSON.stringify(where.OR)).toContain('"status":"scheduled","pickupTime"');
    expect(JSON.stringify(where.OR)).toContain('"pickupPrecision":"minute"');
    expect(JSON.stringify(where.OR)).toContain('"returnPrecision":"minute"');
  });

  it("sends nothing for an account that has the rental domain switched off", async () => {
    const now = new Date();
    mockRentalFindMany.mockResolvedValueOnce([rental({ user: user(["flight"]) }, now)]);
    const { checkRentalReminders } = await import("../rentalReminders");
    await checkRentalReminders(now);
    expect(mockSendRental).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("keeps going when the query for one window fails", async () => {
    const now = new Date();
    mockRentalFindMany.mockRejectedValueOnce(new Error("db down"));
    mockRentalFindMany.mockResolvedValueOnce([
      rental(
        {
          id: "rent-2h",
          pickupTime: new Date(now.getTime() + 2 * HOUR),
          user: { ...user(["rental"]), notifyBefore2h: true },
        },
        now
      ),
    ]);
    const { checkRentalReminders } = await import("../rentalReminders");
    await checkRentalReminders(now);
    expect(mockSendRental).toHaveBeenCalledTimes(1);
    expect(mockSendRental.mock.calls[0][2]).toBe(2);
  });
});

describe("checkRoadtripReminders", () => {
  // A station stores the instant its day begins in its zone. 24 h before 09:00 on
  // that day, in a zone with no DST (Tokyo, UTC+9), is 09:00 the day before.
  function station(now: Date, overrides: Record<string, unknown> = {}) {
    // Local day = tomorrow-in-Tokyo at 09:00 is now+24h when now is 09:00 Tokyo;
    // pin the clock instead of the row: the day starts 9h before the anchor.
    const anchor = new Date(now.getTime() + 24 * HOUR);
    const dayStart = new Date(anchor.getTime() - 9 * HOUR);
    return {
      id: "stop-1",
      title: "Preikestolen Camping",
      startUtc: dayStart,
      endUtc: new Date(dayStart.getTime() + 2 * 24 * HOUR),
      stopZone: "Asia/Tokyo",
      tripId: "trip-1",
      route: { id: "route-1", name: "Norway 2026", tripId: "trip-1", user: user(["roadtrip"]) },
      lodgingStay: { lodging: { name: "Camping Preikestolen" } },
      ...overrides,
    };
  }

  it("announces the next station with the roadtrip id and the stay it sleeps in", async () => {
    const now = new Date(Date.UTC(2026, 5, 10, 0, 0, 0)); // 09:00 in Tokyo
    mockStopFindMany.mockResolvedValueOnce([station(now)]);
    const { checkRoadtripReminders } = await import("../roadtripReminders");
    await checkRoadtripReminders(now);

    expect(mockSendStation).toHaveBeenCalledTimes(1);
    const data = mockSendStation.mock.calls[0][0];
    expect(data).toMatchObject({
      id: "stop-1",
      roadtripId: "route-1",
      stationName: "Preikestolen Camping",
      stayName: "Camping Preikestolen",
      nights: 2,
    });
    expect(mockPush.mock.calls[0][1]).toMatchObject({
      domain: "roadtrip",
      entryId: "stop-1",
      extraIds: { stationId: "stop-1", roadtripId: "route-1" },
    });
  });

  it("only reads stations of a roadtrip, never a route correction", async () => {
    const { checkRoadtripReminders } = await import("../roadtripReminders");
    await checkRoadtripReminders(new Date());
    const where = (mockStopFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.viaPoint).toBe(false);
    expect(where.route).toEqual({ kind: "roadtrip" });
  });

  it("abstains for a station without a zone (no calendar day to read)", async () => {
    const now = new Date(Date.UTC(2026, 5, 10, 0, 0, 0));
    mockStopFindMany.mockResolvedValueOnce([station(now, { stopZone: null })]);
    const { checkRoadtripReminders } = await import("../roadtripReminders");
    await checkRoadtripReminders(now);
    expect(mockSendStation).not.toHaveBeenCalled();
  });

  it("sends nothing when the roadtrip domain is switched off", async () => {
    const now = new Date(Date.UTC(2026, 5, 10, 0, 0, 0));
    const row = station(now);
    row.route = { ...row.route, user: user(["flight"]) };
    mockStopFindMany.mockResolvedValueOnce([row]);
    const { checkRoadtripReminders } = await import("../roadtripReminders");
    await checkRoadtripReminders(now);
    expect(mockSendStation).not.toHaveBeenCalled();
  });
});

describe("checkPlaceVisitReminders", () => {
  function visit(now: Date, overrides: Record<string, unknown> = {}) {
    return {
      id: "visit-1",
      tripId: null,
      notes: "Book a table",
      visitedAtUtc: new Date(now.getTime() + 24 * HOUR),
      visitedZone: "Europe/Rome",
      visitedPrecision: "minute",
      place: {
        id: "place-1",
        name: "Colosseum",
        address: "Piazza del Colosseo",
        city: "Rome",
        country: "Italy",
      },
      user: user(["poi"]),
      ...overrides,
    };
  }

  it("announces a visit with a clock and carries placeId and visitId", async () => {
    const now = new Date();
    mockVisitFindMany.mockResolvedValueOnce([visit(now)]);
    const { checkPlaceVisitReminders } = await import("../placeVisitReminders");
    await checkPlaceVisitReminders(now);

    expect(mockSendVisit).toHaveBeenCalledTimes(1);
    expect(mockSendVisit.mock.calls[0][0]).toMatchObject({
      placeName: "Colosseum",
      placeId: "place-1",
    });
    expect(mockSendVisit.mock.calls[0][0].visitAt.zone).toBe("Europe/Rome");
    expect(mockPush.mock.calls[0][1]).toMatchObject({
      domain: "poi",
      entryId: "visit-1",
      extraIds: { placeId: "place-1", visitId: "visit-1" },
    });
  });

  it("abstains for a visit known only to the day", async () => {
    const now = new Date();
    mockVisitFindMany.mockResolvedValueOnce([visit(now, { visitedPrecision: "day" })]);
    const { checkPlaceVisitReminders } = await import("../placeVisitReminders");
    await checkPlaceVisitReminders(now);
    expect(mockSendVisit).not.toHaveBeenCalled();
  });

  it("queries only visits with a minute-precise real instant", async () => {
    const { checkPlaceVisitReminders } = await import("../placeVisitReminders");
    await checkPlaceVisitReminders(new Date());
    const where = (mockVisitFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.visitedPrecision).toBe("minute");
    expect(where.visitedAtUtc).toBeDefined();
  });

  it("sends nothing when the places domain is switched off", async () => {
    const now = new Date();
    mockVisitFindMany.mockResolvedValueOnce([visit(now, { user: user(["flight"]) })]);
    const { checkPlaceVisitReminders } = await import("../placeVisitReminders");
    await checkPlaceVisitReminders(now);
    expect(mockSendVisit).not.toHaveBeenCalled();
  });
});
