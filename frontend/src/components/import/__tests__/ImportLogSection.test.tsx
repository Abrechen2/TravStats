import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportLogSection } from "../ImportLogSection";
import { listLodgingImportBatches, revertLodgingImportBatch } from "../../../lib/api/lodgingImport";
import { logger } from "../../../lib/logger";
import type { LodgingImportBatchSummary } from "../../../types/lodgingImport";

vi.mock("../../../lib/api/lodgingImport", () => ({
  listLodgingImportBatches: vi.fn(),
  revertLodgingImportBatch: vi.fn(),
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

const csvBatch: LodgingImportBatchSummary = {
  id: "batch-1",
  source: "csv",
  fileName: "places.csv",
  createdAt: "2026-07-01T00:00:00.000Z",
  lodgingCount: 2,
  stayCount: 3,
};

const emailBatch: LodgingImportBatchSummary = {
  id: "batch-2",
  source: "email",
  fileName: null,
  createdAt: "2026-06-15T00:00:00.000Z",
  lodgingCount: 1,
  stayCount: 1,
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
    vi.mocked(listLodgingImportBatches).mockResolvedValue([csvBatch, emailBatch]);

    renderList();

    await waitFor(() => expect(listLodgingImportBatches).toHaveBeenCalled());
    expect(await screen.findByText("lodging:import.batches.source.csv")).toBeInTheDocument();
    expect(screen.getByText(/places\.csv/)).toBeInTheDocument();
    expect(screen.getByText("lodging:import.batches.source.email")).toBeInTheDocument();
    expect(
      screen.getByText("lodging:import.batches.created(lodgingCount:2,stayCount:3)")
    ).toBeInTheDocument();
    expect(
      screen.getByText("lodging:import.batches.created(lodgingCount:1,stayCount:1)")
    ).toBeInTheDocument();
  });

  it("renders the empty state with the section title", async () => {
    vi.mocked(listLodgingImportBatches).mockResolvedValue([]);

    renderList();

    expect(await screen.findByText("lodging:import.batches.empty")).toBeInTheDocument();
    expect(screen.getByText("settings:import.log.title")).toBeInTheDocument();
    // The log must SAY what it does and does not cover — an unqualified
    // "import log" listing only lodging runs would read as "no flight
    // imports happened", which is not what the data means.
    expect(screen.getByText("settings:import.log.scopeHint")).toBeInTheDocument();
  });

  it("labels each entry with the domain it belongs to", async () => {
    vi.mocked(listLodgingImportBatches).mockResolvedValue([csvBatch]);

    renderList();

    expect(await screen.findByText("common:domain.lodging")).toBeInTheDocument();
  });

  it("shows a translated error and logs when the batch fetch fails", async () => {
    vi.mocked(listLodgingImportBatches).mockRejectedValue(new Error("network down"));

    renderList();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("lodging:import.batches.loadError");
    expect(logger.error).toHaveBeenCalled();
  });

  it("does not call revert when the row button is clicked (only opens the confirm dialog)", async () => {
    vi.mocked(listLodgingImportBatches).mockResolvedValue([csvBatch]);

    renderList();
    await screen.findByText(/places\.csv/);

    await userEvent.click(screen.getByTestId("batch-revert-batch-1"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(revertLodgingImportBatch).not.toHaveBeenCalled();
  });

  it("does not call revert when the confirm dialog is cancelled", async () => {
    vi.mocked(listLodgingImportBatches).mockResolvedValue([csvBatch]);

    renderList();
    await screen.findByText(/places\.csv/);
    await userEvent.click(screen.getByTestId("batch-revert-batch-1"));
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByTestId("batch-revert-cancel"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(revertLodgingImportBatch).not.toHaveBeenCalled();
  });

  it("calls revert exactly once with the row's id on confirm, refetches, and calls onReverted", async () => {
    vi.mocked(listLodgingImportBatches).mockResolvedValueOnce([csvBatch]).mockResolvedValueOnce([]);
    vi.mocked(revertLodgingImportBatch).mockResolvedValue({
      deletedLodgings: 2,
      deletedStays: 3,
      detachedLodgings: 0,
    });

    const onReverted = vi.fn();
    renderList({ onReverted });
    await screen.findByText(/places\.csv/);
    await userEvent.click(screen.getByTestId("batch-revert-batch-1"));
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByTestId("batch-revert-confirm"));

    await waitFor(() => expect(revertLodgingImportBatch).toHaveBeenCalledTimes(1));
    expect(revertLodgingImportBatch).toHaveBeenCalledWith("batch-1");
    await waitFor(() => expect(onReverted).toHaveBeenCalledTimes(1));
    // Re-fetches the list after a successful revert (second `listLodgingImportBatches` call).
    await waitFor(() => expect(listLodgingImportBatches).toHaveBeenCalledTimes(2));
  });

  it("shows the honest 'kept' distinction when detachedLodgings > 0", async () => {
    vi.mocked(listLodgingImportBatches).mockResolvedValue([csvBatch]);
    vi.mocked(revertLodgingImportBatch).mockResolvedValue({
      deletedLodgings: 2,
      deletedStays: 3,
      detachedLodgings: 1,
    });

    renderList();
    await screen.findByText(/places\.csv/);
    await userEvent.click(screen.getByTestId("batch-revert-batch-1"));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByTestId("batch-revert-confirm"));

    await waitFor(() => expect(addToastMock).toHaveBeenCalled());
    const [type, message] = addToastMock.mock.calls[0] as [string, string];
    expect(type).toBe("success");
    expect(message).toContain("withDetached");
    expect(message).toContain("detachedLodgings:1");
  });

  it("shows a clean result (no 'kept' clause) when detachedLodgings is 0", async () => {
    vi.mocked(listLodgingImportBatches).mockResolvedValue([csvBatch]);
    vi.mocked(revertLodgingImportBatch).mockResolvedValue({
      deletedLodgings: 2,
      deletedStays: 3,
      detachedLodgings: 0,
    });

    renderList();
    await screen.findByText(/places\.csv/);
    await userEvent.click(screen.getByTestId("batch-revert-batch-1"));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByTestId("batch-revert-confirm"));

    await waitFor(() => expect(addToastMock).toHaveBeenCalled());
    const [type, message] = addToastMock.mock.calls[0] as [string, string];
    expect(type).toBe("success");
    expect(message).not.toContain("detachedLodgings");
    expect(message).toContain("revertResult.success");
  });

  it("shows a translated error (never the raw message) and logs when revert fails", async () => {
    vi.mocked(listLodgingImportBatches).mockResolvedValue([csvBatch]);
    vi.mocked(revertLodgingImportBatch).mockRejectedValue(
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
    vi.mocked(listLodgingImportBatches).mockResolvedValue([csvBatch]);

    const { rerender } = render(<ImportLogSection onReverted={vi.fn()} reloadKey={1} />);
    await waitFor(() => expect(listLodgingImportBatches).toHaveBeenCalledTimes(1));

    rerender(<ImportLogSection onReverted={vi.fn()} reloadKey={2} />);
    await waitFor(() => expect(listLodgingImportBatches).toHaveBeenCalledTimes(2));
  });
});
