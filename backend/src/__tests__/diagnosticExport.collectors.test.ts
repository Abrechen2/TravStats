/**
 * Unit tests for collectSettings and collectFlightState — the two new
 * per-user collectors that feed the v2 diagnostic bundle. Prisma is mocked
 * (no DB involvement — fast + deterministic).
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockUserSettingsFindUnique = jest.fn();
const mockFlightGroupBy = jest.fn();
const mockFlightCount = jest.fn();
const mockPendingFindCount = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    userSettings: { findUnique: mockUserSettingsFindUnique },
    flight: { groupBy: mockFlightGroupBy, count: mockFlightCount },
    pendingFlightUpdate: { count: mockPendingFindCount },
  },
}));

jest.mock("../services/logManager", () => ({
  readLogWindow: jest.fn(),
  listLogFiles: jest.fn(async () => []),
  getLogStats: jest.fn(async () => ({ totalSize: 0, fileCount: 0, categoryBreakdown: {} })),
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  systemLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { collectSettings, collectFlightState } from "../services/diagnosticExport";

describe("collectSettings — allowlist", () => {
  beforeEach(() => jest.clearAllMocks());

  it("projects only the allowlisted settings fields", async () => {
    mockUserSettingsFindUnique.mockResolvedValue({
      userId: "u1",
      autoUpdateEnabled: true,
      autoUpdateRequireApproval: false,
      autoUpdateCheckInterval: 15,
      autoUpdateOnlyDuringFlight: false,
      autoUpdateExpiryHours: 24,
      historicalEnrichmentEnabled: true,
      historicalEnrichmentMinConfidence: 60,
      historicalEnrichmentMaxPerDay: 50,
      // These must NOT appear in the output:
      openaiApiKey: "sk-real",
      claudeApiKey: "sk-real",
      airlabsApiKey: "key",
      aviationstackApiKey: "key",
      openskyClientSecret: "secret",
      openskyPassword: "pw",
      preferredVisionParser: "auto",
    });

    const settings = await collectSettings("u1");

    expect(settings).toEqual({
      autoUpdate: {
        enabled: true,
        requireApproval: false,
        checkInterval: 15,
        onlyDuringFlight: false,
        expiryHours: 24,
      },
      historicalEnrichment: {
        enabled: true,
        minConfidence: 60,
        maxPerDay: 50,
      },
    });

    // Defensive: serialized snapshot must not contain any of the dangerous fields
    const serialized = JSON.stringify(settings);
    expect(serialized).not.toMatch(/sk-real|key|secret|pw|preferredVisionParser/i);
  });

  it("returns documented defaults when the UserSettings row is missing", async () => {
    mockUserSettingsFindUnique.mockResolvedValue(null);

    const settings = await collectSettings("u1");

    expect(settings.autoUpdate.enabled).toBe(false);
    expect(settings.autoUpdate.requireApproval).toBe(true);
    expect(settings.historicalEnrichment.enabled).toBe(false);
  });
});

describe("collectFlightState — aggregates", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reports byStatus counts per user", async () => {
    mockFlightGroupBy.mockResolvedValue([
      { status: "scheduled", _count: { _all: 7 } },
      { status: "flown", _count: { _all: 40 } },
      { status: "cancelled", _count: { _all: 2 } },
      { status: "historical", _count: { _all: 3 } },
    ]);
    // 5 pipeline counts
    mockFlightCount
      .mockResolvedValueOnce(5)  // withNextApiCheck
      .mockResolvedValueOnce(38) // withLiveTracking
      .mockResolvedValueOnce(12) // withActualTimes
      .mockResolvedValueOnce(1); // zombieCandidates
    mockPendingFindCount.mockResolvedValueOnce(2); // withPendingUpdates

    const state = await collectFlightState("u1");

    expect(state.byStatus).toEqual({
      scheduled: 7,
      flown: 40,
      cancelled: 2,
      historical: 3,
      duplicated: 0, // not returned by groupBy → defaults to 0
    });
    expect(state.pipeline).toEqual({
      withNextApiCheck: 5,
      withPendingUpdates: 2,
      withLiveTracking: 38,
      withActualTimes: 12,
      zombieCandidates: 1,
    });
  });

  it("scopes every query by userId", async () => {
    mockFlightGroupBy.mockResolvedValue([]);
    mockFlightCount.mockResolvedValue(0);
    mockPendingFindCount.mockResolvedValue(0);

    await collectFlightState("u1");

    // Every call's `where` filters on userId = 'u1'
    for (const call of mockFlightCount.mock.calls) {
      expect((call[0] as { where: { userId: string } }).where.userId).toBe("u1");
    }
    expect(
      (mockFlightGroupBy.mock.calls[0][0] as { where: { userId: string } }).where.userId,
    ).toBe("u1");
    expect(
      (mockPendingFindCount.mock.calls[0][0] as { where: { userId: string } }).where.userId,
    ).toBe("u1");
  });

  it("zombieCandidates query uses OR of arrivalTime+6h and departureTime+30h", async () => {
    mockFlightGroupBy.mockResolvedValue([]);
    mockFlightCount.mockResolvedValue(0);
    mockPendingFindCount.mockResolvedValue(0);

    await collectFlightState("u1");

    // 4th count call is zombieCandidates
    const zombieCall = mockFlightCount.mock.calls[3][0] as {
      where: {
        status: string;
        OR: Array<
          | { arrivalTime: { not: null; lt: Date } }
          | { departureTime: { not: null; lt: Date } }
        >;
      };
    };
    expect(zombieCall.where.status).toBe("scheduled");
    expect(zombieCall.where.OR).toHaveLength(2);

    const arrBranch = zombieCall.where.OR.find(
      (b): b is { arrivalTime: { not: null; lt: Date } } => "arrivalTime" in b,
    );
    const depBranch = zombieCall.where.OR.find(
      (b): b is { departureTime: { not: null; lt: Date } } => "departureTime" in b,
    );
    expect(arrBranch).toBeDefined();
    expect(depBranch).toBeDefined();

    // 6h and 30h cutoffs, ±1 min tolerance for test-execution drift
    const arrExpected = Date.now() - 6 * 3600 * 1000;
    const depExpected = Date.now() - 30 * 3600 * 1000;
    expect(Math.abs(arrBranch!.arrivalTime.lt.getTime() - arrExpected)).toBeLessThan(60_000);
    expect(Math.abs(depBranch!.departureTime.lt.getTime() - depExpected)).toBeLessThan(60_000);
  });
});
