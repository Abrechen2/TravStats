/**
 * Tests for the bulk historical refresh service.
 *
 * Coverage:
 * - Provider gate: `hasHistoricalProvider` returns true iff Aviationstack
 *   OR AeroDataBox is configured
 * - Candidate query: only flights inside the 365-day window with at least
 *   one missing field (`aircraftRegistration` / `aircraftModeS` / `isCodeshare`)
 *   are returned
 * - `runBulkRefresh` patches only the missing fields, never overwriting
 *   existing values
 *
 * The route-level demo gate is exercised by `flights.test.ts` via the
 * authenticated request flow.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const apiKeyResolverMock = {
  getApiKey: jest.fn(async (_provider: string, _userId?: string) => null as string | null),
};
jest.mock("../services/apiKeyResolver", () => apiKeyResolverMock);

const flightLookupMock = {
  lookupFlightWithHistorical: jest.fn(),
};
jest.mock("../services/flightLookup", () => flightLookupMock);

const prismaMock = {
  flight: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
};
jest.mock("../db", () => ({ prisma: prismaMock }));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────
import {
  hasHistoricalProvider,
  runBulkRefresh,
} from "../services/bulkFlightRefresh";

const USER_ID = "user-1";

describe("hasHistoricalProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns false when no key is configured", async () => {
    apiKeyResolverMock.getApiKey.mockResolvedValue(null);
    expect(await hasHistoricalProvider(USER_ID)).toBe(false);
  });

  it("returns true when Aviationstack is configured", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider) =>
      provider === "aviationstack" ? "av-key" : null,
    );
    expect(await hasHistoricalProvider(USER_ID)).toBe(true);
  });

  it("returns true when AeroDataBox is configured", async () => {
    apiKeyResolverMock.getApiKey.mockImplementation(async (provider) =>
      provider === "aerodatabox" ? "adb-key" : null,
    );
    expect(await hasHistoricalProvider(USER_ID)).toBe(true);
  });
});

describe("runBulkRefresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.flight.count.mockResolvedValue(0);
  });

  it("patches only missing fields and never overwrites existing values", async () => {
    const flight = {
      id: "f1",
      flightNumber: "LH401",
      departureTime: new Date(Date.now() - 30 * 86400000),
    };
    prismaMock.flight.findMany.mockResolvedValue([flight]);

    // The DB row already has a registration the user typed manually, but
    // is missing Mode-S and codeshare. The patch must touch only Mode-S
    // and codeshare, leaving the typed registration alone.
    prismaMock.flight.findUnique.mockResolvedValue({
      aircraftRegistration: "D-USER-TYPED",
      aircraftModeS: null,
      isCodeshare: null,
      airlineIata: "LH",
      airlineIcao: "DLH",
      operatingAirlineIata: null,
      operatingAirlineIcao: null,
    });

    flightLookupMock.lookupFlightWithHistorical.mockResolvedValue({
      flights: [
        {
          aircraftRegistration: "D-PROVIDER",
          aircraftModeS: "3C6518",
          isCodeshare: true,
          airlineIata: "LH",
          airlineIcao: "DLH",
        },
      ],
    });

    const summary = await runBulkRefresh(USER_ID);

    expect(summary.scanned).toBe(1);
    expect(summary.updated).toBe(1);
    expect(summary.failed).toBe(0);
    expect(prismaMock.flight.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.flight.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: {
        aircraftModeS: "3C6518",
        isCodeshare: true,
      },
    });
  });


  /**
   * The owner's report, 2026-09-03: three recently flown flights with no
   * aircraft type and no actual times, and "refreshing the backlog changed
   * nothing here". It HAD changed something — the registrations were written
   * by an earlier run out of the very same provider response that carried the
   * model and the times. Only five fields were ever copied out of it.
   */
  it("writes the aircraft type and the actual times the same response carried", async () => {
    prismaMock.flight.findMany.mockResolvedValue([
      { id: "f1", flightNumber: "LX93", departureTime: new Date(Date.now() - 2 * 86400000) },
    ]);
    prismaMock.flight.findUnique.mockResolvedValue({
      aircraftRegistration: "HB-JNG",
      aircraftModeS: "4B191C",
      isCodeshare: true,
      airlineIata: "LX",
      airlineIcao: "SWR",
      operatingAirlineIata: null,
      operatingAirlineIcao: null,
      // Exactly how the reported rows looked: empty STRING, not null.
      aircraft: "",
      actualDeparture: null,
      actualArrival: null,
    });
    flightLookupMock.lookupFlightWithHistorical.mockResolvedValue({
      flights: [
        {
          aircraftRegistration: "HB-JNG",
          aircraft: "Boeing 777-300ER",
          departure: { actualTime: "2026-09-02T21:31:00.000Z" },
          arrival: { actualTime: "2026-09-03T08:52:00.000Z" },
        },
      ],
    });

    const summary = await runBulkRefresh(USER_ID);

    expect(summary.updated).toBe(1);
    expect(prismaMock.flight.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: {
        aircraft: "Boeing 777-300ER",
        actualDeparture: new Date("2026-09-02T21:31:00.000Z"),
        actualArrival: new Date("2026-09-03T08:52:00.000Z"),
      },
    });
  });

  it("never overwrites an aircraft type or an actual time that is already there", async () => {
    prismaMock.flight.findMany.mockResolvedValue([
      { id: "f1", flightNumber: "LX93", departureTime: new Date(Date.now() - 2 * 86400000) },
    ]);
    prismaMock.flight.findUnique.mockResolvedValue({
      aircraftRegistration: "HB-JNG",
      aircraftModeS: "4B191C",
      isCodeshare: true,
      airlineIata: "LX",
      airlineIcao: "SWR",
      operatingAirlineIata: null,
      operatingAirlineIcao: null,
      aircraft: "A340-300 (user typed)",
      actualDeparture: new Date("2026-09-02T21:00:00.000Z"),
      actualArrival: null,
    });
    flightLookupMock.lookupFlightWithHistorical.mockResolvedValue({
      flights: [
        {
          aircraft: "Boeing 777-300ER",
          departure: { actualTime: "2026-09-02T21:31:00.000Z" },
          arrival: { actualTime: "2026-09-03T08:52:00.000Z" },
        },
      ],
    });

    await runBulkRefresh(USER_ID);

    // Only the one genuinely empty column is filled.
    expect(prismaMock.flight.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { actualArrival: new Date("2026-09-03T08:52:00.000Z") },
    });
  });

  it("treats a flight whose only gap is the aircraft type as a candidate", async () => {
    // Without this the fix above would be unreachable for every flight that
    // has been refreshed once: the three original fields fill on the first
    // pass, and a filled flight is never a candidate again. Both spellings of
    // empty are asked for, because that column holds "" as well as NULL.
    prismaMock.flight.findMany.mockResolvedValue([]);

    await runBulkRefresh(USER_ID);

    const where = prismaMock.flight.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([{ aircraft: null }, { aircraft: "" }])
    );
  });

  it("counts provider 'no_provider' / empty result as no_data and writes nothing", async () => {
    const flight = {
      id: "f1",
      flightNumber: "LH401",
      departureTime: new Date(Date.now() - 30 * 86400000),
    };
    prismaMock.flight.findMany.mockResolvedValue([flight]);
    flightLookupMock.lookupFlightWithHistorical.mockResolvedValue({
      flights: [],
      unavailableReason: "no_provider",
    });

    const summary = await runBulkRefresh(USER_ID);

    expect(summary.noData).toBe(1);
    expect(summary.updated).toBe(0);
    expect(prismaMock.flight.update).not.toHaveBeenCalled();
  });

  it("separates 'already complete' from 'the provider has nothing'", async () => {
    // These were one number, and the owner read the wrong meaning out of it:
    // "refreshing changed nothing" was true of the fields he was watching and
    // false of the run, which had filled others minutes earlier. One word for
    // "the API has nothing on this leg" and "the API has it and you already
    // do" makes that unreadable.
    prismaMock.flight.findMany.mockResolvedValue([
      { id: "f1", flightNumber: "LH401", departureTime: new Date(Date.now() - 30 * 86400000) },
    ]);
    prismaMock.flight.findUnique.mockResolvedValue({
      aircraftRegistration: "D-ABYT",
      aircraftModeS: "3C4B34",
      isCodeshare: true,
      airlineIata: "LH",
      airlineIcao: "DLH",
      operatingAirlineIata: null,
      operatingAirlineIcao: null,
      aircraft: "Boeing 747-8",
      actualDeparture: new Date("2026-08-30T20:11:00.000Z"),
      actualArrival: new Date("2026-08-31T07:44:00.000Z"),
    });
    flightLookupMock.lookupFlightWithHistorical.mockResolvedValue({
      flights: [{ aircraftRegistration: "D-ABYT", aircraft: "Boeing 747-8" }],
    });

    const summary = await runBulkRefresh(USER_ID);

    expect(summary.alreadyComplete).toBe(1);
    expect(summary.noData).toBe(0);
    expect(summary.results[0].outcome).toBe("already_complete");
    expect(prismaMock.flight.update).not.toHaveBeenCalled();
  });

  it("says WHY a flight yielded nothing", async () => {
    // A missing key, a date the free tier refuses and a leg the provider does
    // not know are three different answers that shared one word.
    prismaMock.flight.findMany.mockResolvedValue([
      { id: "f1", flightNumber: "LH401", departureTime: new Date(Date.now() - 30 * 86400000) },
    ]);
    flightLookupMock.lookupFlightWithHistorical.mockResolvedValue({
      flights: [],
      unavailableReason: "no_provider",
    });

    const summary = await runBulkRefresh(USER_ID);

    expect(summary.results[0]).toMatchObject({
      outcome: "no_data",
      reason: "no_provider",
    });
  });

  it("captures lookup exceptions as failed without aborting the batch", async () => {
    const flights = [
      { id: "f1", flightNumber: "LH401", departureTime: new Date(Date.now() - 30 * 86400000) },
      { id: "f2", flightNumber: "LH402", departureTime: new Date(Date.now() - 30 * 86400000) },
    ];
    prismaMock.flight.findMany.mockResolvedValue(flights);
    prismaMock.flight.findUnique.mockResolvedValue({
      aircraftRegistration: null,
      aircraftModeS: null,
      isCodeshare: null,
      airlineIata: null,
      airlineIcao: null,
      operatingAirlineIata: null,
      operatingAirlineIcao: null,
    });

    flightLookupMock.lookupFlightWithHistorical
      .mockRejectedValueOnce(new Error("provider 500"))
      .mockResolvedValueOnce({
        flights: [{ aircraftRegistration: "D-OK", aircraftModeS: "ABC", isCodeshare: false }],
      });

    const summary = await runBulkRefresh(USER_ID);

    expect(summary.scanned).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.updated).toBe(1);
  }, 10000); // pacing between flights pushes us close to the default 5s
});
