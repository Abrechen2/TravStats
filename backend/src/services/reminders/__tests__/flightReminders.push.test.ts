import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFindMany = jest.fn<() => Promise<FlightFixture[]>>();
jest.mock("../../../db", () => ({
  prisma: { flight: { findMany: mockFindMany } },
}));

const mockSendFlightReminder = jest.fn<typeof import("../../emailService").sendFlightReminder>();
jest.mock("../../emailService", () => ({
  sendFlightReminder: mockSendFlightReminder,
}));

jest.mock("../../airportCache", () => ({ getCachedAirport: jest.fn() }));

const mockNotifyEntryReminder =
  jest.fn<typeof import("../../notifications/dispatcher").notifyEntryReminder>();
jest.mock("../../notifications/dispatcher", () => ({
  notifyEntryReminder: mockNotifyEntryReminder,
}));

const mockWarn = jest.fn();
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: mockWarn, error: jest.fn(), debug: jest.fn() },
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

type UserFixture = {
  id: string;
  reminderPreferences: Array<{
    domain: string;
    enabled: boolean;
    leadHours: number[];
    channel: string;
  }>;
  devicePushes: Array<{ reminders: boolean }>;
  notificationEmail: string | null;
  notifyBefore24h: boolean;
  notifyBefore2h: boolean;
  settings: { data: unknown; enabledDomains: string[] } | null;
};

type FlightFixture = Omit<ReturnType<typeof makeFlight>, "tripId"> & {
  tripId: string | null;
  terminal?: string | null;
  gate?: string | null;
  seatClass?: string | null;
  bookingReference?: string | null;
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
      id: "user-1",
      notificationEmail: "user@example.com",
      notifyBefore24h: true,
      notifyBefore2h: true,
      // Flights are on by default; the channel is the test's choice.
      settings: { data: {}, enabledDomains: ["flight"] },
      reminderPreferences: [
        { domain: "flight", enabled: true, leadHours: [24, 2], channel: "both" },
      ],
      devicePushes: [],
      ...user,
    },
  };
}

/** The cron queries once per window: 24h first, then 2h. */
function stage(first: FlightFixture[], second: FlightFixture[] = []): void {
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
    mockNotifyEntryReminder.mockResolvedValue(undefined);
    mockSendFlightReminder.mockResolvedValue(undefined);
  });

  const only = (channel: string, leadHours = [24, 2], enabled = true) => ({
    reminderPreferences: [{ domain: "flight", enabled, leadHours, channel }],
  });

  it("pushes the 24h reminder for a user without notificationEmail, and sends no e-mail", async () => {
    stage([makeFlight({ notificationEmail: null, ...only("app") })]);
    await run();

    expect(mockNotifyEntryReminder).toHaveBeenCalledTimes(1);
    const [userId, entry] = mockNotifyEntryReminder.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(entry).toMatchObject({ domain: "flight", entryId: "flight-a", hours: 24 });
    expect(mockSendFlightReminder).not.toHaveBeenCalled();
  });

  it("hands the dispatcher the flight's trip, so a phone's per-trip mute can apply (forgejo#286)", async () => {
    stage([{ ...makeFlight(only("app")), tripId: "trip-9" }]);
    await run();

    expect(mockNotifyEntryReminder.mock.calls[0][1].tripId).toBe("trip-9");
  });

  it("pushes the 2h reminder with hours 2", async () => {
    stage([], [makeFlight(only("app"), 2)]);
    await run();

    expect(mockNotifyEntryReminder).toHaveBeenCalledTimes(1);
    expect(mockNotifyEntryReminder.mock.calls[0][1].hours).toBe(2);
  });

  it("sends both e-mail and push on the channel 'both'", async () => {
    stage([makeFlight(only("both"))]);
    await run();

    expect(mockSendFlightReminder).toHaveBeenCalledTimes(1);
    expect(mockNotifyEntryReminder).toHaveBeenCalledTimes(1);
  });

  it("sends only the mail on the channel 'mail' and only the push on 'app'", async () => {
    stage([makeFlight(only("mail"))]);
    await run();
    expect(mockSendFlightReminder).toHaveBeenCalledTimes(1);
    expect(mockNotifyEntryReminder).not.toHaveBeenCalled();

    jest.clearAllMocks();
    stage([makeFlight(only("app"))]);
    await run();
    expect(mockSendFlightReminder).not.toHaveBeenCalled();
    expect(mockNotifyEntryReminder).toHaveBeenCalledTimes(1);
  });

  it("sends nothing at a lead the account did not choose, and nothing for a disabled domain", async () => {
    stage([makeFlight(only("both", [2]))]); // 24 h window, only 2 h chosen
    await run();
    expect(mockSendFlightReminder).not.toHaveBeenCalled();
    expect(mockNotifyEntryReminder).not.toHaveBeenCalled();

    stage([makeFlight(only("both", [24, 2], false))]);
    await run();
    expect(mockSendFlightReminder).not.toHaveBeenCalled();
    expect(mockNotifyEntryReminder).not.toHaveBeenCalled();
  });

  it("an account's custom lead hour is scheduled like the presets", async () => {
    mockFindMany.mockImplementation(async () => []);
    // activeLeadHours reads the custom values in use.
    const leads = await import("../prefs");
    jest.spyOn(leads, "activeLeadHours").mockResolvedValue([24, 6, 2]);
    mockFindMany.mockResolvedValueOnce([]); // 24
    mockFindMany.mockResolvedValueOnce([makeFlight(only("app", [24, 6, 2]), 6)]); // 6
    mockFindMany.mockResolvedValueOnce([]); // 2
    await run();

    expect(mockNotifyEntryReminder).toHaveBeenCalledTimes(1);
    expect(mockNotifyEntryReminder.mock.calls[0][1].hours).toBe(6);
  });

  it("still e-mails (positive control) when the push notifier rejects, and logs a warning", async () => {
    mockNotifyEntryReminder.mockRejectedValue(new Error("relay down"));
    stage([makeFlight(only("both"))]);
    await run();

    expect(mockSendFlightReminder).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "reminder_push_failed", entryId: "flight-a" })
    );
  });

  it("a failing mail does not skip the push (the channels are independent)", async () => {
    mockSendFlightReminder.mockRejectedValue(new Error("smtp down"));
    stage([makeFlight(only("both"))]);
    await run();

    expect(mockNotifyEntryReminder).toHaveBeenCalledTimes(1);
  });

  it("does not remind about a flight that is not yet due (positive control: a due one does)", async () => {
    stage([makeFlight(only("both"), 26), makeFlight(only("both"), 24, "flight-b")]);
    await run();

    expect(mockNotifyEntryReminder).toHaveBeenCalledTimes(1);
    expect(mockNotifyEntryReminder.mock.calls[0][1].entryId).toBe("flight-b");
  });

  it("e-mails only once across runs (the durable claim)", async () => {
    const flight = makeFlight(only("mail"));
    stage([flight]);
    await run();
    stage([flight]);
    const { checkFlightReminders } = await import("../flightReminders");
    await checkFlightReminders(new Date());

    expect(mockSendFlightReminder).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a flight whose domain the account switched off", async () => {
    stage([makeFlight({ settings: { data: {}, enabledDomains: ["cruise"] } })]);
    await run();

    expect(mockSendFlightReminder).not.toHaveBeenCalled();
    expect(mockNotifyEntryReminder).not.toHaveBeenCalled();
  });

  it("hands the mail terminal, gate, class and booking reference", async () => {
    stage([
      {
        ...makeFlight(),
        terminal: "2",
        gate: "K24",
        seatClass: "business",
        bookingReference: "X7YZ9Q",
      },
    ]);
    await run();

    const [flight] = mockSendFlightReminder.mock.calls[0];
    expect(flight).toMatchObject({
      terminal: "2",
      gate: "K24",
      seatClass: "business",
      bookingReference: "X7YZ9Q",
    });
  });
});
