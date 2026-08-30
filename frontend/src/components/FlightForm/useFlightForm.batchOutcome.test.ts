/**
 * A batch import has to say what it did.
 *
 * Forgejo #13: re-importing the same multi-leg MSG replayed the entire review
 * wizard with no duplicate warning, and after the last click the dialog just
 * closed. The flight count did not move and nothing explained why — the server
 * had skipped every row as already present, and the frontend used only
 * `newAchievements` from the response, discarding `count` and `skipped`.
 *
 * A silent no-op after four screens of review is the worst available outcome,
 * because it is indistinguishable from a failure. The user tries again.
 *
 * All four outcomes are pinned, including the one nobody expects — rows sent,
 * none created, none skipped — because that is the case where staying quiet
 * would hide a genuine fault.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ParsedBooking } from "../../types";

const mocks = vi.hoisted(() => ({
  onSubmit: vi.fn(),
  createBatch: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  airportsApi: { getByCode: vi.fn() },
}));
vi.mock("../../lib/api/flights", () => ({
  flightsApi: { createBatch: mocks.createBatch },
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" }, ready: true }),
}));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({
    units: { currency: "EUR" },
    defaults: {},
    display: { timezone: "Europe/Berlin" },
    features: {},
  }),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: { getState: () => ({ addToast: mocks.addToast }) },
}));
vi.mock("../../lib/timeEstimation", () => ({
  storeHistoricalFlightTime: vi.fn(),
  estimateFlightTimes: vi.fn(() => ({
    arrivalTime: "14:00",
    source: "heuristic",
    confidence: "low",
  })),
}));

import { useFlightForm } from "./useFlightForm";

const leg = (flightNumber: string): ParsedBooking =>
  ({ flightNumber, missing: [] }) as unknown as ParsedBooking;

/** Walks the wizard to its last step, which is the only step that writes. */
async function runTwoLegImport(): Promise<void> {
  const { result } = renderHook(() => useFlightForm(mocks.onSubmit, vi.fn()));

  act(() => {
    result.current.setParsedFlights([leg("LH400"), leg("LH401")]);
    result.current.setCurrentFlightIndex(0);
  });

  await act(async () => {
    await result.current.handleFlightReviewConfirm({ flightNumber: "LH400" } as never);
  });
  await act(async () => {
    await result.current.handleFlightReviewConfirm({ flightNumber: "LH401" } as never);
  });
}

describe("useFlightForm — what the batch import reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says nothing was imported when every row was already on file", async () => {
    mocks.createBatch.mockResolvedValue({ flights: [], count: 0, skipped: 2 });
    await runTwoLegImport();

    expect(mocks.addToast).toHaveBeenCalledWith("info", "flights:review.batchAllDuplicates");
  });

  it("reports both halves of a partial import", async () => {
    mocks.createBatch.mockResolvedValue({ flights: [{}], count: 1, skipped: 1 });
    await runTwoLegImport();

    expect(mocks.addToast).toHaveBeenCalledWith("success", "flights:review.batchImportedWithSkips");
  });

  it("confirms a clean import", async () => {
    mocks.createBatch.mockResolvedValue({ flights: [{}, {}], count: 2, skipped: 0 });
    await runTwoLegImport();

    expect(mocks.addToast).toHaveBeenCalledWith("success", "flights:review.batchImported");
  });

  it("does not stay quiet when rows were sent and nothing came back", async () => {
    // Neither created nor skipped. No branch describes this, so silence would
    // look exactly like the bug being fixed.
    mocks.createBatch.mockResolvedValue({ flights: [], count: 0, skipped: 0 });
    await runTwoLegImport();

    expect(mocks.addToast).toHaveBeenCalledWith("error", "errors:saveFailed");
  });
});
