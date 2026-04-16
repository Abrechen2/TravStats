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

import { collectSettings } from "../services/diagnosticExport";

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
