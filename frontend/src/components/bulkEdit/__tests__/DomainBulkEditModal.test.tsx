import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const edit = vi.fn();
vi.mock("../../../lib/api/domainBulkEdit", () => ({
  domainBulkEditApi: { edit: (...a: unknown[]) => edit(...a) },
}));
const getAll = vi.fn();
vi.mock("../../../lib/api/trips", () => ({ tripsApi: { getAll: () => getAll() } }));
vi.mock("../../TagInput", () => ({
  default: ({ id, onChange }: { id?: string; onChange: (v: string[]) => void }) => (
    <input id={id} aria-label="tags-input" onChange={(e) => onChange(e.target.value.split(","))} />
  ),
}));
vi.mock("../../CompanionPicker", () => ({
  default: ({ onChange }: { onChange: (v: string[]) => void }) => (
    <input aria-label="companions-input" onChange={(e) => onChange(e.target.value.split(","))} />
  ),
}));

import DomainBulkEditModal from "../DomainBulkEditModal";
import type { BulkRow } from "../useRowSelection";
import type { BulkDomain } from "../../../shared/bulkEditFields";

const ROWS: BulkRow[] = [
  { id: "a", label: "Köln → Bonn", tags: ["work"], updatedAt: "2026-05-01T00:00:00.000Z" },
  { id: "b", label: "Bonn → Mainz", updatedAt: "2026-05-02T00:00:00.000Z" },
  { id: "c", label: "Mainz → Trier", status: "cancelled" },
];

async function renderModal(domain: BulkDomain = "rail", rows: BulkRow[] = ROWS) {
  const onApplied = vi.fn();
  const onClose = vi.fn();
  render(
    <DomainBulkEditModal domain={domain} rows={rows} onClose={onClose} onApplied={onApplied} />
  );
  // The trips load on open; let that settle so nothing renders outside act.
  await act(async () => {
    await Promise.resolve();
  });
  return { onApplied, onClose };
}

const confirm = () => screen.getByRole("button", { name: /bulkEdit:confirm/ });

/** forgejo#405 A4 — the flights bulk edit's modal, for every other domain. */
describe("DomainBulkEditModal", () => {
  beforeEach(() => {
    edit.mockReset();
    getAll.mockReset();
    getAll.mockResolvedValue([{ id: "t1", name: "Herbst" }]);
  });

  it("offers only the fields the domain accepts", async () => {
    await renderModal("stay");
    expect(screen.getByRole("group", { name: "bulkEdit:field.trip" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "bulkEdit:field.companions" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "bulkEdit:field.status" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "bulkEdit:field.tags" })).toBeNull();
    expect(screen.queryByRole("group", { name: "bulkEdit:field.operator" })).toBeNull();
  });

  it("offers operator and class for a ride, not for a cruise", async () => {
    await renderModal("ferry");
    expect(screen.getByRole("group", { name: "bulkEdit:field.operator" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "bulkEdit:field.serviceClass" })).toBeInTheDocument();
  });

  it("keeps the confirm grey and says why until something is chosen", async () => {
    await renderModal();
    expect(confirm()).toBeDisabled();
    expect(screen.getByRole("button", { name: "bulkEdit:missing.nothing" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("radio", { name: "bulkEdit:mode.tripClear" }));
    expect(confirm()).toBeEnabled();
  });

  it("sends the rows' versions with the request and previews the status change", async () => {
    edit.mockResolvedValueOnce({
      results: ROWS.map((r) => ({ id: r.id, status: "updated" })),
      summary: { updated: 3, unchanged: 0, failed: 0 },
    });
    const user = userEvent.setup();
    const { onApplied } = await renderModal();
    await user.click(screen.getByRole("radio", { name: "bulkEdit:mode.statusCancel" }));
    expect(screen.getByTestId("bulk-preview-status")).toHaveTextContent(
      'bulkEdit:preview.status.cancel {"count":2'
    );
    await user.click(confirm());
    expect(edit).toHaveBeenCalledWith("rail", {
      ids: ["a", "b", "c"],
      baseVersions: { a: "2026-05-01T00:00:00.000Z", b: "2026-05-02T00:00:00.000Z" },
      status: { mode: "cancel" },
    });
    expect(await screen.findByTestId("bulk-results")).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("names each failed row and retries only the ones the database refused", async () => {
    edit
      .mockResolvedValueOnce({
        results: [
          { id: "a", status: "updated" },
          { id: "b", status: "failed", code: "UPDATE_FAILED" },
          { id: "c", status: "failed", code: "VERSION_CONFLICT" },
        ],
        summary: { updated: 1, unchanged: 0, failed: 2 },
      })
      .mockResolvedValueOnce({
        results: [{ id: "b", status: "updated" }],
        summary: { updated: 1, unchanged: 0, failed: 0 },
      });
    const user = userEvent.setup();
    const { onApplied } = await renderModal();
    await user.click(screen.getByRole("radio", { name: "bulkEdit:mode.tripClear" }));
    await user.click(confirm());

    expect(await screen.findByTestId("bulk-failed-b")).toHaveTextContent(
      "Bonn → Mainz: bulkEdit:result.code.UPDATE_FAILED"
    );
    // A row that moved on elsewhere is named, never overwritten, and says to reload.
    expect(screen.getByTestId("bulk-failed-c")).toHaveTextContent(
      "bulkEdit:result.code.VERSION_CONFLICT"
    );
    await user.click(screen.getByRole("button", { name: "bulkEdit:reloadList" }));
    expect(onApplied).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: /bulkEdit:result\.retryFailed/ }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(edit).toHaveBeenLastCalledWith("rail", {
      ids: ["b"],
      baseVersions: { b: "2026-05-02T00:00:00.000Z" },
      trip: { mode: "clear" },
    });
    await waitFor(() => expect(screen.queryByTestId("bulk-failed-b")).toBeNull());
    expect(screen.getByTestId("bulk-failed-c")).toBeInTheDocument();
  });

  it("retries a stay whose write failed after its claim from the version the server names", async () => {
    edit
      .mockResolvedValueOnce({
        results: [
          { id: "a", status: "failed", code: "UPDATE_FAILED", version: "2026-05-01T00:00:00.001Z" },
        ],
        summary: { updated: 0, unchanged: 0, failed: 1 },
      })
      .mockResolvedValueOnce({
        results: [{ id: "a", status: "updated" }],
        summary: { updated: 1, unchanged: 0, failed: 0 },
      });
    const user = userEvent.setup();
    await renderModal("stay", [ROWS[0]]);
    await user.click(screen.getByRole("radio", { name: "bulkEdit:mode.statusCancel" }));
    await user.click(confirm());
    await user.click(await screen.findByRole("button", { name: /bulkEdit:result\.retryFailed/ }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(edit.mock.calls[1][1].baseVersions).toEqual({ a: "2026-05-01T00:00:00.001Z" });
  });

  it("says the outcome is unknown when no answer arrives, and retries safely", async () => {
    edit
      .mockRejectedValueOnce(Object.assign(new Error("Network Error"), { isAxiosError: true }))
      .mockResolvedValueOnce({
        results: ROWS.map((r) => ({ id: r.id, status: "updated" })),
        summary: { updated: 3, unchanged: 0, failed: 0 },
      });
    const user = userEvent.setup();
    await renderModal();
    await user.click(screen.getByRole("radio", { name: "bulkEdit:mode.tripClear" }));
    await user.click(confirm());
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("bulkEdit:outcomeUnknown");
    expect(screen.getByRole("radio", { name: "bulkEdit:mode.tripClear" })).toBeChecked();
    await user.click(within(banner).getByRole("button", { name: "common:buttons.retry" }));
    expect(await screen.findByTestId("bulk-results")).toBeInTheDocument();
    expect(edit).toHaveBeenCalledTimes(2);
  });

  it("says so when the trips cannot be loaded, and offers them again", async () => {
    getAll
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([{ id: "t1", name: "Herbst" }]);
    const user = userEvent.setup();
    await renderModal();
    await user.click(screen.getByRole("radio", { name: "bulkEdit:mode.tripSet" }));
    expect(await screen.findByText(/bulkEdit:tripsFailed/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    expect(await screen.findByRole("option", { name: "Herbst" })).toBeInTheDocument();
  });

  it("only offers the closed class list for a train, free text for a bus", async () => {
    const user = userEvent.setup();
    await renderModal("rail");
    const choices = screen.getByRole("group", { name: "bulkEdit:field.serviceClass" });
    await user.click(within(choices).getByRole("radio", { name: "bulkEdit:mode.textSet" }));
    expect(
      screen.getByRole("combobox", { name: "bulkEdit:field.serviceClass" })
    ).toBeInTheDocument();
  });

  it("types an operator for a ferry and sends it trimmed", async () => {
    edit.mockResolvedValueOnce({
      results: ROWS.map((r) => ({ id: r.id, status: "unchanged" })),
      summary: { updated: 0, unchanged: 3, failed: 0 },
    });
    const user = userEvent.setup();
    await renderModal("ferry");
    const choices = screen.getByRole("group", { name: "bulkEdit:field.operator" });
    await user.click(within(choices).getByRole("radio", { name: "bulkEdit:mode.textSet" }));
    expect(confirm()).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "bulkEdit:field.operator" }), {
      target: { value: " Stena " },
    });
    await user.click(confirm());
    expect(edit.mock.calls[0][1]).toMatchObject({ operator: { mode: "set", value: "Stena" } });
  });

  it("gives its choices touch size on a coarse pointer", async () => {
    await renderModal();
    const label = screen.getByRole("radio", { name: "bulkEdit:mode.tripClear" }).closest("label");
    expect(label?.className).toContain("pointer-coarse:min-h-(--ts-size-touch-min)");
  });

  it("caps the selection at 200 with the reason beside the grey confirm", async () => {
    await renderModal(
      "rail",
      Array.from({ length: 201 }, (_, i) => ({ id: `r${i}`, label: `R${i}` }))
    );
    expect(screen.getByRole("button", { name: /bulkEdit:missing\.tooMany/ })).toBeInTheDocument();
  });
});
