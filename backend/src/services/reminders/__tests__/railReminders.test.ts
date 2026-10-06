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
  bookingId: string | null;
  depStationId: number | null;
  arrStationId: number | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  status?: string;
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
    bookingId: null,
    depStationId: null,
    arrStationId: null,
    depLat: 52.5251,
    depLon: 13.3694,
    arrLat: 48.1402,
    arrLon: 11.56,
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
    const [legs, , hoursAhead] = mockSendRailReminder.mock.calls[0] as [
      Array<{ departure: { zone: string }; arrival: { zone: string } }>,
      unknown,
      number,
    ];
    expect(hoursAhead).toBe(24);
    // A ride of one train is a list of one — the single-train mail, as before.
    expect(legs).toHaveLength(1);
    const [journeyData] = legs;
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

    const [[journey]] = mockSendRailReminder.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(journey.travelClass).toBe("first");
    expect(journey.bookingReference).toBe("ABC123");
  });
});

/**
 * forgejo#210: a ride with changes is ONE reminder. Augsburg → München
 * (ICE 911) → Salzburg (EC 115) used to send two "in 24h" mails — one per
 * train, the second 65 minutes after the first.
 *
 * The fake answers both queries the job makes the way Postgres would: the
 * window query by status, departure range and clock, the booking query by
 * booking, status and the ids it excludes. So the job is tested against the
 * rows, not against the order it happens to ask in.
 */
describe("checkRailReminders — one reminder per ride (forgejo#210)", () => {
  const HOUR = 60 * 60 * 1000;
  const MIN = 60 * 1000;
  const T0 = new Date("2026-10-11T07:12:00.000Z"); // ICE 911 leaves Augsburg

  const STATIONS = {
    augsburg: { name: "Augsburg Hbf", lat: 48.3655, lon: 10.8856 },
    muenchen: { name: "München Hbf", lat: 48.1402, lon: 11.56 },
    salzburg: { name: "Salzburg Hbf", lat: 47.8128, lon: 13.0456 },
    berlin: { name: "Berlin Hbf", lat: 52.5251, lon: 13.3694 },
    hamburg: { name: "Hamburg Hbf", lat: 53.553, lon: 10.0067 },
  } as const;
  type Station = keyof typeof STATIONS;

  function leg(
    id: string,
    from: Station,
    to: Station,
    departure: Date,
    minutes: number,
    over: Partial<JourneyFixture> = {}
  ): JourneyFixture {
    const dep = STATIONS[from];
    const arr = STATIONS[to];
    return makeJourney({
      id,
      bookingId: "booking-1",
      status: "scheduled",
      depStationName: dep.name,
      depLat: dep.lat,
      depLon: dep.lon,
      depTimezone: "Europe/Berlin",
      arrStationName: arr.name,
      arrLat: arr.lat,
      arrLon: arr.lon,
      arrTimezone: "Europe/Berlin",
      departureTime: departure,
      arrivalTime: new Date(departure.getTime() + minutes * MIN),
      ...over,
    });
  }

  const ICE_911 = leg("leg-ice", "augsburg", "muenchen", T0, 40, {
    trainCategory: "ICE",
    trainNumber: "911",
    coach: "7",
    seat: "61",
  });
  const EC_115 = leg("leg-ec", "muenchen", "salzburg", new Date(T0.getTime() + 65 * MIN), 100, {
    trainCategory: "EC",
    trainNumber: "115",
    coach: "254",
    seat: "45",
  });

  interface FindManyArgs {
    where: {
      departureTime?: { gte: Date; lte: Date };
      bookingId?: { in: string[] };
      id?: { notIn: string[] };
      status?: string;
    };
  }

  function serve(rows: JourneyFixture[]): void {
    mockFindMany.mockImplementation(async (...params: unknown[]) => {
      const { where } = params[0] as FindManyArgs;
      return rows.filter((row) => {
        if (where.status && (row.status ?? "scheduled") !== where.status) return false;
        if (where.departureTime) {
          const t = row.departureTime.getTime();
          if (t < where.departureTime.gte.getTime() || t > where.departureTime.lte.getTime()) {
            return false;
          }
          if (row.depPrecision === "day" || row.depPrecision === "unknown") return false;
        }
        if (where.bookingId && !(row.bookingId && where.bookingId.in.includes(row.bookingId))) {
          return false;
        }
        if (where.id && where.id.notIn.includes(row.id)) return false;
        return true;
      });
    });
  }

  type SentLeg = { id: string; trainNumber: string | null; arrStationName: string };
  const sentRides = (): Array<{ legs: SentLeg[]; hours: number }> =>
    (mockSendRailReminder.mock.calls as Array<[SentLeg[], unknown, number]>).map(
      ([legs, , hours]) => ({ legs, hours })
    );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it("sends a two-train ride once per window, listing both trains, named by its destination", async () => {
    serve([ICE_911, EC_115]);
    const { checkRailReminders } = await import("../railReminders");
    const { railRideReminderContent } = await import("../../email/reminderContent");

    // 24 h before the first train, then when the SECOND train is 24 h out —
    // the tick that used to send the second mail — and the same for 2 h.
    await checkRailReminders(new Date(T0.getTime() - 24 * HOUR));
    await checkRailReminders(new Date(EC_115.departureTime.getTime() - 24 * HOUR));
    await checkRailReminders(new Date(T0.getTime() - 2 * HOUR));
    await checkRailReminders(new Date(EC_115.departureTime.getTime() - 2 * HOUR));

    const sent = sentRides();
    expect(sent.map((ride) => ride.hours)).toEqual([24, 2]);
    for (const ride of sent) {
      expect(ride.legs.map((l) => l.id)).toEqual(["leg-ice", "leg-ec"]);
    }

    const [legs] = mockSendRailReminder.mock.calls[0] as [
      Parameters<typeof railRideReminderContent>[0],
    ];
    const de = railRideReminderContent(legs, 24, "de", { base: "https://x.test" });
    const en = railRideReminderContent(legs, 24, "en", { base: "https://x.test" });
    expect(de.subject).toBe("Zug-Erinnerung: Deine Fahrt nach Salzburg Hbf in 24h");
    expect(en.subject).toBe("Train reminder: your journey to Salzburg Hbf in 24h");
  });

  it("keeps a single train exactly as before: one leg, its own mail", async () => {
    const single = leg("leg-single", "berlin", "hamburg", T0, 110, { bookingId: null });
    serve([single]);
    const { checkRailReminders } = await import("../railReminders");

    await checkRailReminders(new Date(T0.getTime() - 24 * HOUR));

    expect(sentRides()).toEqual([
      { legs: [expect.objectContaining({ id: "leg-single" })], hours: 24 },
    ]);
  });

  it("sends two mails for two separate rides in the same window", async () => {
    const other = leg("leg-other", "berlin", "hamburg", new Date(T0.getTime() + 5 * MIN), 110, {
      bookingId: "booking-2",
    });
    serve([ICE_911, EC_115, other]);
    const { checkRailReminders } = await import("../railReminders");

    await checkRailReminders(new Date(T0.getTime() - 24 * HOUR));

    expect(sentRides().map((ride) => ride.legs.map((l) => l.id))).toEqual([
      ["leg-ice", "leg-ec"],
      ["leg-other"],
    ]);
  });

  it("does not send a ride twice across two scheduler ticks", async () => {
    serve([ICE_911, EC_115]);
    const { checkRailReminders } = await import("../railReminders");

    await checkRailReminders(new Date(T0.getTime() - 24 * HOUR));
    await checkRailReminders(new Date(T0.getTime() - 24 * HOUR + 5 * MIN));

    expect(mockSendRailReminder).toHaveBeenCalledTimes(1);
  });

  it("asks the switches of the ride's user: no 24h mail when that window is off", async () => {
    const user = { ...ICE_911.user, notifyBefore24h: false };
    serve([
      { ...ICE_911, user },
      { ...EC_115, user },
    ]);
    const { checkRailReminders } = await import("../railReminders");

    await checkRailReminders(new Date(T0.getTime() - 24 * HOUR));
    await checkRailReminders(new Date(EC_115.departureTime.getTime() - 24 * HOUR));

    expect(mockSendRailReminder).not.toHaveBeenCalled();
  });

  it("leaves a cancelled train out of the ride", async () => {
    serve([ICE_911, { ...EC_115, status: "cancelled" }]);
    const { checkRailReminders } = await import("../railReminders");

    await checkRailReminders(new Date(T0.getTime() - 24 * HOUR));

    expect(sentRides().map((ride) => ride.legs.map((l) => l.id))).toEqual([["leg-ice"]]);
  });
});
