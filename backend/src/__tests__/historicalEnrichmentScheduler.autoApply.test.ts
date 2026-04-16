/**
 * Unit tests for the historical-enrichment auto-apply branch.
 *
 * Regression: before the fix, historical enrichment unconditionally left pending
 * updates as status="pending", even when the user had opted out of the approval
 * gate (`autoUpdateRequireApproval=false`). Live API updates had this branch;
 * historical did not — so enriched rows rotted until the 24h expiry reaper.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// ─── Mocks (all declared before module under test imports) ──────────────────

const mockUserSettingsFindUnique = jest.fn();
const mockFlightFindUnique = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    userSettings: { findUnique: mockUserSettingsFindUnique },
    flight: { findUnique: mockFlightFindUnique },
  },
}));

const mockGetUserEnrichmentSettings = jest.fn();
const mockFindEnrichmentCandidates = jest.fn();
const mockAggregateFlightData = jest.fn();
const mockCreateHistoricalEnrichment = jest.fn();

jest.mock("../services/flightEnrichmentService", () => ({
  getUserEnrichmentSettings: mockGetUserEnrichmentSettings,
  findEnrichmentCandidates: mockFindEnrichmentCandidates,
  aggregateFlightData: mockAggregateFlightData,
  createHistoricalEnrichment: mockCreateHistoricalEnrichment,
}));

const mockApplyPendingUpdate = jest.fn();
jest.mock("../services/pendingUpdateService", () => ({
  applyPendingUpdate: mockApplyPendingUpdate,
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────
import { processUserHistoricalEnrichment } from "../jobs/historicalEnrichmentScheduler";

const USER_ID = "test-flight-user-001";

const mockCandidate = (id: string) => ({
  flightId: id,
  enrichmentMode: "full" as const,
});

const mockFlight = (id: string) => ({
  id,
  userId: USER_ID,
  flightNumber: "LH400",
});

const mockAggregated = () => ({
  confidence: 95,
  sourceFlightsCount: 5,
});

describe("processUserHistoricalEnrichment auto-apply branch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserEnrichmentSettings.mockResolvedValue({
      enabled: true,
      minConfidence: 60,
      maxPerDay: 50,
    });
    mockAggregateFlightData.mockResolvedValue(mockAggregated());
  });

  it("auto-applies created enrichments when user has requireApproval=false", async () => {
    mockUserSettingsFindUnique.mockResolvedValue({ autoUpdateRequireApproval: false });
    mockFindEnrichmentCandidates.mockResolvedValue([
      mockCandidate("f1"),
      mockCandidate("f2"),
    ]);
    mockFlightFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      mockFlight(where.id),
    );
    mockCreateHistoricalEnrichment.mockImplementation(
      async (flightId: string) => `pu-${flightId}`,
    );
    mockApplyPendingUpdate.mockResolvedValue({ id: "dummy" });

    const result = await processUserHistoricalEnrichment(USER_ID);

    expect(result).toEqual({ processed: 2, created: 2, skipped: 0 });
    // Both pending updates must be auto-applied
    expect(mockApplyPendingUpdate).toHaveBeenCalledTimes(2);
    expect(mockApplyPendingUpdate).toHaveBeenCalledWith("pu-f1", USER_ID);
    expect(mockApplyPendingUpdate).toHaveBeenCalledWith("pu-f2", USER_ID);
  });

  it("leaves enrichments pending when user has requireApproval=true", async () => {
    mockUserSettingsFindUnique.mockResolvedValue({ autoUpdateRequireApproval: true });
    mockFindEnrichmentCandidates.mockResolvedValue([mockCandidate("f1")]);
    mockFlightFindUnique.mockResolvedValue(mockFlight("f1"));
    mockCreateHistoricalEnrichment.mockResolvedValue("pu-f1");

    const result = await processUserHistoricalEnrichment(USER_ID);

    expect(result.created).toBe(1);
    expect(mockApplyPendingUpdate).not.toHaveBeenCalled();
  });

  it("leaves enrichments pending when user settings row is missing", async () => {
    // Defensive: no UserSettings row means we haven't seen an explicit opt-out;
    // default to the safe side (require approval).
    mockUserSettingsFindUnique.mockResolvedValue(null);
    mockFindEnrichmentCandidates.mockResolvedValue([mockCandidate("f1")]);
    mockFlightFindUnique.mockResolvedValue(mockFlight("f1"));
    mockCreateHistoricalEnrichment.mockResolvedValue("pu-f1");

    await processUserHistoricalEnrichment(USER_ID);

    expect(mockApplyPendingUpdate).not.toHaveBeenCalled();
  });

  it("continues to the next candidate when one applyPendingUpdate fails", async () => {
    mockUserSettingsFindUnique.mockResolvedValue({ autoUpdateRequireApproval: false });
    mockFindEnrichmentCandidates.mockResolvedValue([
      mockCandidate("f1"),
      mockCandidate("f2"),
    ]);
    mockFlightFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      mockFlight(where.id),
    );
    mockCreateHistoricalEnrichment.mockImplementation(
      async (flightId: string) => `pu-${flightId}`,
    );
    // First apply returns null (failure), second succeeds
    mockApplyPendingUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "dummy" });

    const result = await processUserHistoricalEnrichment(USER_ID);

    // Created count is still 2 — pending rows exist for audit.
    // Apply was attempted for both.
    expect(result.created).toBe(2);
    expect(mockApplyPendingUpdate).toHaveBeenCalledTimes(2);
  });
});
