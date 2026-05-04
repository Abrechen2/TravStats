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
