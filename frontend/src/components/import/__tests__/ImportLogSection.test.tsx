import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportLogSection } from "../ImportLogSection";
import { listImportBatches, revertImportBatch } from "../../../lib/api/importBatches";
import { logger } from "../../../lib/logger";
import type { ImportBatchSummary } from "../../../lib/api/importBatches";

vi.mock("../../../lib/api/importBatches", () => ({
  listImportBatches: vi.fn(),
  revertImportBatch: vi.fn(),
}));

vi.mock("../../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const addToastMock = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...args: unknown[]) => void }) => unknown) =>
    selector({ addToast: (...args: unknown[]) => addToastMock(...args) }),
}));

// `t` echoes the key, appending interpolated options so the revert-result
// toast (which passes `{ deletedLodgings, deletedStays, detachedLodgings }`)
// produces a distinguishable string per branch — the global setup.ts mock
// ignores options entirely, which would hide the exact distinction this
// suite needs to verify (Task 18b, owner semantics: detachedLodgings > 0
// MUST read differently from 0).
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>): string => {
      if (options && Object.keys(options).length > 0) {
        const parts = Object.entries(options)
          .map(([k, v]) => `${k}:${String(v)}`)
          .join(",");
        return `${key}(${parts})`;
      }
      return key;
    },
    i18n: { language: "en" },
    ready: true,
  }),
}));

const csvBatch: ImportBatchSummary = {
  id: "batch-1",
  domain: "lodging",
  source: "csv",
  fileName: "places.csv",
  createdAt: "2026-07-01T00:00:00.000Z",
  counts: { lodgings: 2, stays: 3, flights: 0, cruises: 0 },
};

const emailBatch: ImportBatchSummary = {
  id: "batch-2",
  domain: "lodging",
  source: "email",
  fileName: null,
  createdAt: "2026-06-15T00:00:00.000Z",
  counts: { lodgings: 1, stays: 1, flights: 0, cruises: 0 },
};

// The reason this component was touched at all: a flight logbook import used
// to leave no trace, so the log said "nothing imported yet" while 160 flights
// had just landed.
const flightBatch: ImportBatchSummary = {
  id: "batch-3",
  domain: "flight",
  source: "csv",
  fileName: "logbook.csv",
  createdAt: "2026-08-01T00:00:00.000Z",
  counts: { lodgings: 0, stays: 0, flights: 160, cruises: 0 },
};

function renderList(
  props?: Partial<{ onReverted: () => void | Promise<void>; reloadKey: unknown }>
) {
  const onReverted = props?.onReverted ?? vi.fn();
  const utils = render(
    <ImportLogSection onReverted={onReverted} reloadKey={props?.reloadKey} />
  );
  return { ...utils, onReverted };
}

describe("ImportLogSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders rows from the fetched batches — source, fileName, date, created counts", async () => {
    vi.mocked(listImportBatches).mockResolvedValue([csvBatch, emailBatch]);

    renderList();

    await waitFor(() => expect(listImportBatches).toHaveBeenCalled());
    expect(await screen.findByText("lodging:import.batches.source.csv")).toBeInTheDocument();
    expect(screen.getByText(/places\.csv/)).toBeInTheDocument();
    expect(screen.getByText("lodging:import.batches.source.email")).toBeInTheDocument();
    expect(
      screen.getByText(
        "lodging:import.batches.created(hotels:lodging:units.hotels(count:2),stays:lodging:units.stays(count:3))"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "lodging:import.batches.created(hotels:lodging:units.hotels(count:1),stays:lodging:units.stays(count:1))"
      )
    ).toBeInTheDocument();
  });

  it("renders the empty state with the section title", async () => {
    vi.mocked(listImportBatches).mockResolvedValue([]);

    renderList();

    expect(await screen.findByText("lodging:import.batches.empty")).toBeInTheDocument();
    expect(screen.getByText("settings:import.log.title")).toBeInTheDocument();
    // The log must SAY what it does and does not cover — an unqualified
    // "import log" listing only lodging runs would read as "no flight
    // imports happened", which is not what the data means.
    expect(screen.getByText("settings:import.log.scopeHint")).toBeInTheDocument();
  });

  it("labels each entry with the domain it belongs to", async () => {
    vi.mocked(listImportBatches).mockResolvedValue([csvBatch]);

    renderList();

    expect(await screen.findByText("common:domain.lodging")).toBeInTheDocument();
  });

  // The whole reason this component changed: a flight import used to be
  // invisible here, so the log read "nothing imported yet" right after 160
  // flights had landed.
  it("shows a flight import with its own label and its own count", async () => {
    vi.mocked(listImportBatches).mockResolvedValue([flightBatch, csvBatch]);

    renderList();

    expect(await screen.findByText("common:domain.flight")).toBeInTheDocument();
    expect(screen.getByText("common:domain.lodging")).toBeInTheDocument();
    // Counted in the words of its own area — "160 flights", not "160 rows".
    expect(screen.getByText("settings:import.log.counts.flights(count:160)")).toBeInTheDocument();
  });

  it("shows a translated error and logs when the batch fetch fails", async () => {
    vi.mocked(listImportBatches).mockRejectedValue(new Error("network down"));

    renderList();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("lodging:import.batches.loadError");
    expect(logger.error).toHaveBeenCalled();
  });

  it("does not call revert when the row button is clicked (only opens the confirm dialog)", async () => {
    vi.mocked(listImportBatches).mockResolvedValue([csvBatch]);

    renderList();
    await screen.findByText(/places\.csv/);

    await userEvent.click(screen.getByTestId("batch-revert-batch-1"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(revertImportBatch).not.toHaveBeenCalled();
  });

  it("does not call revert when the confirm dialog is cancelled", async () => {
    vi.mocked(listImportBatches).mockResolvedValue([csvBatch]);

    renderList();
    await screen.findByText(/places\.csv/);
    await userEvent.click(screen.getByTestId("batch-revert-batch-1"));
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByTestId("batch-revert-cancel"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(revertImportBatch).not.toHaveBeenCalled();
  });

  it("calls revert exactly once with the row's id on confirm, refetches, and calls onReverted", async () => {
    vi.mocked(listImportBatches).mockResolvedValueOnce([csvBatch]).mockResolvedValueOnce([]);
    vi.mocked(revertImportBatch).mockResolvedValue({ domain: "lodging", deleted: 5 });

    const onReverted = vi.fn();
    renderList({ onReverted });
    await screen.findByText(/places\.csv/);
    await userEvent.click(screen.getByTestId("batch-revert-batch-1"));
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByTestId("batch-revert-confirm"));

    await waitFor(() => expect(revertImportBatch).toHaveBeenCalledTimes(1));
    expect(revertImportBatch).toHaveBeenCalledWith("batch-1");
    await waitFor(() => expect(onReverted).toHaveBeenCalledTimes(1));
    // Re-fetches the list after a successful revert (second `listImportBatches` call).
    await waitFor(() => expect(listImportBatches).toHaveBeenCalledTimes(2));
  });

  it("shows the honest 'kept' distinction when detachedLodgings > 0", async () => {
    vi.mocked(listImportBatches).mockResolvedValue([csvBatch]);
    vi.mocked(revertImportBatch).mockResolvedValue({ domain: "lodging", deleted: 5, detached: 1 });

    renderList();
    await screen.findByText(/places\.csv/);
    await userEvent.click(screen.getByTestId("batch-revert-batch-1"));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByTestId("batch-revert-confirm"));

    await waitFor(() => expect(addToastMock).toHaveBeenCalled());
    const [type, message] = addToastMock.mock.calls[0] as [string, string];
    expect(type).toBe("success");
    expect(message).toContain("revertedWithKept");
    expect(message).toContain("kept:1");
  });

  it("shows a clean result (no 'kept' clause) when detachedLodgings is 0", async () => {
    vi.mocked(listImportBatches).mockResolvedValue([csvBatch]);
    vi.mocked(revertImportBatch).mockResolvedValue({ domain: "lodging", deleted: 5 });

    renderList();
    await screen.findByText(/places\.csv/);
    await userEvent.click(screen.getByTestId("batch-revert-batch-1"));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByTestId("batch-revert-confirm"));

    await waitFor(() => expect(addToastMock).toHaveBeenCalled());
    const [type, message] = addToastMock.mock.calls[0] as [string, string];
    expect(type).toBe("success");
    // No "kept" clause when nothing had to be kept — the distinction only
    // appears where it means something.
    expect(message).not.toContain("kept");
    expect(message).toContain("settings:import.log.reverted");
  });

  it("shows a translated error (never the raw message) and logs when revert fails", async () => {
    vi.mocked(listImportBatches).mockResolvedValue([csvBatch]);
    vi.mocked(revertImportBatch).mockRejectedValue(
      new Error("SQL constraint violation on lodging_import_batches")
    );

    renderList();
    await screen.findByText(/places\.csv/);
    await userEvent.click(screen.getByTestId("batch-revert-batch-1"));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByTestId("batch-revert-confirm"));

    await waitFor(() => expect(addToastMock).toHaveBeenCalled());
    const [type, message] = addToastMock.mock.calls[0] as [string, string];
    expect(type).toBe("error");
    expect(message).not.toContain("SQL constraint violation");
    expect(message).toBe("lodging:import.batches.revertError");
    expect(logger.error).toHaveBeenCalled();
  });

  it("re-fetches when reloadKey changes (a new import landed elsewhere on the page)", async () => {
    vi.mocked(listImportBatches).mockResolvedValue([csvBatch]);

    const { rerender } = render(<ImportLogSection onReverted={vi.fn()} reloadKey={1} />);
    await waitFor(() => expect(listImportBatches).toHaveBeenCalledTimes(1));

    rerender(<ImportLogSection onReverted={vi.fn()} reloadKey={2} />);
    await waitFor(() => expect(listImportBatches).toHaveBeenCalledTimes(2));
  });
});
