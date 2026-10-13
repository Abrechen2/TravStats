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

const mockUserSettingsFindUnique =
  jest.fn<
    (
      args: import("../prisma").Prisma.UserSettingsFindUniqueArgs
    ) => Promise<Partial<import("../generated/prisma/client").UserSettings> | null>
  >();
const mockFlightFindMany =
  jest.fn<
    (
      args: import("../prisma").Prisma.FlightFindManyArgs
    ) => Promise<Partial<import("../generated/prisma/client").Flight>[]>
  >();

jest.mock("../db", () => ({
  prisma: {
    userSettings: { findUnique: mockUserSettingsFindUnique },
    flight: { findMany: mockFlightFindMany },
  },
}));

const mockGetUserEnrichmentSettings =
  jest.fn<
    () => Promise<
      Awaited<
        ReturnType<typeof import("../services/flightEnrichmentService").getUserEnrichmentSettings>
      >
    >
  >();
const mockFindEnrichmentCandidates = jest.fn<() => Promise<ReturnType<typeof mockCandidate>[]>>();
const mockAggregateFlightData = jest.fn<() => Promise<ReturnType<typeof mockAggregated> | null>>();
const mockCreateHistoricalEnrichment = jest.fn<(flightId: string) => Promise<string | null>>();

jest.mock("../services/flightEnrichmentService", () => ({
  getUserEnrichmentSettings: mockGetUserEnrichmentSettings,
  findEnrichmentCandidates: mockFindEnrichmentCandidates,
  aggregateFlightData: mockAggregateFlightData,
  createHistoricalEnrichment: mockCreateHistoricalEnrichment,
}));

const mockApplyPendingUpdate = jest.fn<() => Promise<{ id: string } | null>>();
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
    jest.resetAllMocks();
    mockGetUserEnrichmentSettings.mockResolvedValue({
      enabled: true,
      minConfidence: 60,
      maxPerDay: 50,
    });
    mockAggregateFlightData.mockResolvedValue(mockAggregated());
  });

  it("auto-applies created enrichments when user has requireApproval=false", async () => {
    mockUserSettingsFindUnique.mockResolvedValue({ autoUpdateRequireApproval: false });
    mockFindEnrichmentCandidates.mockResolvedValue([mockCandidate("f1"), mockCandidate("f2")]);
    mockFlightFindMany.mockResolvedValue([mockFlight("f2"), mockFlight("f1")]);
    mockCreateHistoricalEnrichment.mockImplementation(async (flightId: string) => `pu-${flightId}`);
    mockApplyPendingUpdate.mockResolvedValue({ id: "dummy" });

    const result = await processUserHistoricalEnrichment(USER_ID);

    expect(result).toEqual({ processed: 2, created: 2, skipped: 0 });
    expect(mockFlightFindMany).toHaveBeenCalledTimes(1);
    expect(mockFlightFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: ["f1", "f2"] } },
      select: { id: true, flightNumber: true },
    });
    expect(mockCreateHistoricalEnrichment.mock.calls.map(([id]) => id)).toEqual(["f1", "f2"]);
    // Both pending updates must be auto-applied
    expect(mockApplyPendingUpdate).toHaveBeenCalledTimes(2);
    expect(mockApplyPendingUpdate).toHaveBeenCalledWith("pu-f1", USER_ID);
    expect(mockApplyPendingUpdate).toHaveBeenCalledWith("pu-f2", USER_ID);
  });

  it("leaves enrichments pending when user has requireApproval=true", async () => {
    mockUserSettingsFindUnique.mockResolvedValue({ autoUpdateRequireApproval: true });
    mockFindEnrichmentCandidates.mockResolvedValue([mockCandidate("f1")]);
    mockFlightFindMany.mockResolvedValue([mockFlight("f1")]);
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
    mockFlightFindMany.mockResolvedValue([mockFlight("f1")]);
    mockCreateHistoricalEnrichment.mockResolvedValue("pu-f1");

    await processUserHistoricalEnrichment(USER_ID);

    expect(mockApplyPendingUpdate).not.toHaveBeenCalled();
  });

  it("continues to the next candidate when one applyPendingUpdate fails", async () => {
    mockUserSettingsFindUnique.mockResolvedValue({ autoUpdateRequireApproval: false });
    mockFindEnrichmentCandidates.mockResolvedValue([mockCandidate("f1"), mockCandidate("f2")]);
    mockFlightFindMany.mockResolvedValue([mockFlight("f2"), mockFlight("f1")]);
    mockCreateHistoricalEnrichment.mockImplementation(async (flightId: string) => `pu-${flightId}`);
    // First apply returns null (failure), second succeeds
    mockApplyPendingUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "dummy" });

    const result = await processUserHistoricalEnrichment(USER_ID);

    // Created count is still 2 — pending rows exist for audit.
    // Apply was attempted for both.
    expect(result.created).toBe(2);
    expect(mockApplyPendingUpdate).toHaveBeenCalledTimes(2);
  });
  it("limits the batch before loading and skips missing or unnumbered flights", async () => {
    mockGetUserEnrichmentSettings.mockResolvedValue({
      enabled: true,
      minConfidence: 60,
      maxPerDay: 3,
    });
    mockUserSettingsFindUnique.mockResolvedValue({ autoUpdateRequireApproval: true });
    mockFindEnrichmentCandidates.mockResolvedValue(
      ["missing", "unnumbered", "ok", "over-limit"].map(mockCandidate)
    );
    mockFlightFindMany.mockResolvedValue([
      { id: "unnumbered", flightNumber: null },
      mockFlight("ok"),
    ]);
    mockCreateHistoricalEnrichment.mockResolvedValue("pu-ok");

    expect(await processUserHistoricalEnrichment(USER_ID)).toEqual({
      processed: 3,
      created: 1,
      skipped: 2,
    });
    expect(mockFlightFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: ["missing", "unnumbered", "ok"] } },
      select: { id: true, flightNumber: true },
    });
    expect(mockAggregateFlightData).toHaveBeenCalledTimes(1);
  });

  it.each([0, 50])("does no flight read when there is no work (limit %i)", async (maxPerDay) => {
    mockGetUserEnrichmentSettings.mockResolvedValue({
      enabled: true,
      minConfidence: 60,
      maxPerDay,
    });
    mockFindEnrichmentCandidates.mockResolvedValue(maxPerDay === 0 ? [mockCandidate("f1")] : []);
    expect(await processUserHistoricalEnrichment(USER_ID)).toEqual({
      processed: 0,
      created: 0,
      skipped: 0,
    });
    expect(mockFlightFindMany).not.toHaveBeenCalled();
    expect(mockUserSettingsFindUnique).not.toHaveBeenCalled();
  });
});
