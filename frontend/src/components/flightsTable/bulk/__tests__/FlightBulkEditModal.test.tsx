import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Flight, Trip } from "../../../../types";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const edit = vi.fn();
vi.mock("../../../../lib/api/flightBulkEdit", () => ({
  BULK_EDIT_MAX_FLIGHTS: 200,
  flightBulkEditApi: { edit: (...a: unknown[]) => edit(...a) },
}));
// The chip inputs have their own suites and fetch suggestions on mount; here
// a comma-separated text field stands in for each.
vi.mock("../../../TagInput", () => ({
  default: ({ id, onChange }: { id?: string; onChange: (v: string[]) => void }) => (
    <input id={id} aria-label="tags-input" onChange={(e) => onChange(e.target.value.split(","))} />
  ),
}));
vi.mock("../../../CompanionPicker", () => ({
  default: ({ onChange }: { onChange: (v: string[]) => void }) => (
    <input aria-label="companions-input" onChange={(e) => onChange(e.target.value.split(","))} />
  ),
}));

import FlightBulkEditModal from "../FlightBulkEditModal";

const flight = (id: string, over: Partial<Flight> = {}): Flight =>
  ({
    id,
    airline: "LH",
    flightNumber: id.toUpperCase(),
    departureTime: "2026-11-02T06:00:00Z",
    arrivalTime: "2026-11-02T07:00:00Z",
    status: "flown",
    createdAt: "2026-01-01T00:00:00Z",
    tags: [],
    companions: [],
    ...over,
  }) as Flight;

const FLIGHTS = [flight("a", { tags: ["work"] }), flight("b"), flight("c")];
const TRIPS = [{ id: "t1", name: "Herbst" } as Trip];

function renderModal(onApplied = vi.fn(), onClose = vi.fn(), flights: Flight[] = FLIGHTS) {
  render(
    <FlightBulkEditModal
      flights={flights}
      trips={TRIPS}
      labelOf={(id) => `Flight ${id}`}
      onClose={onClose}
      onApplied={onApplied}
    />
  );
  return { onApplied, onClose };
}

const confirmButton = () => screen.getByRole("button", { name: /flights:bulk\.confirm/ });

/** forgejo#217 — bulk edit over an explicit selection. */
describe("FlightBulkEditModal", () => {
  beforeEach(() => edit.mockReset());

  it("keeps the confirm grey and says why until something is chosen", async () => {
    renderModal();
    expect(confirmButton()).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "flights:bulk.missing.nothing" })
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("radio", { name: "flights:bulk.tripClear" }));
    expect(confirmButton()).toBeEnabled();
  });

  it("previews add versus replace before anything is sent", async () => {
    const user = userEvent.setup();
    renderModal();
    const tagChoices = screen.getByRole("group", { name: "flights:bulk.tags" });
    await user.click(within(tagChoices).getByRole("radio", { name: "flights:bulk.add" }));
    fireEvent.change(screen.getByLabelText("tags-input"), { target: { value: "autumn" } });
    expect(screen.getByTestId("bulk-preview-tags")).toHaveTextContent(
      'flights:bulk.preview.tagsAdd {"values":"autumn","count":3}'
    );
    await user.click(within(tagChoices).getByRole("radio", { name: "flights:bulk.replace" }));
    fireEvent.change(screen.getByLabelText("tags-input"), { target: { value: "autumn" } });
    const preview = screen.getByTestId("bulk-preview-tags");
    expect(preview).toHaveTextContent("flights:bulk.preview.tagsReplace");
    expect(preview).toHaveTextContent('flights:bulk.preview.lost {"values":"work"}');
    expect(edit).not.toHaveBeenCalled();
  });

  it("lists per-flight failures and retries only the failed flights", async () => {
    edit
      .mockResolvedValueOnce({
        results: [
          { flightId: "a", status: "updated" },
          { flightId: "b", status: "failed", code: "UPDATE_FAILED" },
          { flightId: "c", status: "failed", code: "FLIGHT_NOT_FOUND" },
        ],
        summary: { updated: 1, unchanged: 0, failed: 2 },
      })
      .mockResolvedValueOnce({
        results: [{ flightId: "b", status: "updated" }],
        summary: { updated: 1, unchanged: 0, failed: 0 },
      });
    const user = userEvent.setup();
    const { onApplied } = renderModal();
    await user.click(screen.getByRole("radio", { name: "flights:bulk.tripClear" }));
    await user.click(confirmButton());

    expect(edit).toHaveBeenCalledWith({ flightIds: ["a", "b", "c"], trip: { mode: "clear" } });
    expect(await screen.findByTestId("bulk-failed-b")).toHaveTextContent(
      "Flight b: flights:bulk.result.code.UPDATE_FAILED"
    );
    expect(screen.getByTestId("bulk-failed-c")).toHaveTextContent(
      "flights:bulk.result.code.FLIGHT_NOT_FOUND"
    );
    expect(onApplied).toHaveBeenCalledTimes(1);

    // The flight that is gone is not sent again; the refused one is, alone.
    await user.click(screen.getByRole("button", { name: /flights:bulk\.result\.retryFailed/ }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(edit).toHaveBeenLastCalledWith({ flightIds: ["b"], trip: { mode: "clear" } });
    await waitFor(() => expect(screen.queryByTestId("bulk-failed-b")).toBeNull());
    expect(screen.getByTestId("bulk-failed-c")).toBeInTheDocument();
  });

  it("keeps the draft and offers a retry when the whole request fails", async () => {
    edit
      .mockRejectedValueOnce(Object.assign(new Error("Network Error"), { isAxiosError: true }))
      .mockResolvedValueOnce({
        results: FLIGHTS.map((f) => ({ flightId: f.id, status: "updated" })),
        summary: { updated: 3, unchanged: 0, failed: 0 },
      });
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("radio", { name: "flights:bulk.tripClear" }));
    await user.click(confirmButton());
    const banner = await screen.findByRole("alert");
    // No answer: the outcome is unknown, never "nothing changed" (review I2).
    expect(banner).toHaveTextContent("flights:bulk.outcomeUnknown");
    expect(screen.getByRole("radio", { name: "flights:bulk.tripClear" })).toBeChecked();
    await user.click(within(banner).getByRole("button", { name: "common:buttons.retry" }));
    expect(await screen.findByTestId("bulk-results")).toBeInTheDocument();
    expect(edit).toHaveBeenCalledTimes(2);
  });

  it("closes an untouched draft on Escape without asking", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before a changed draft is discarded on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole("radio", { name: "flights:bulk.tripClear" }));
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
  });

  it("gives its choices touch size on a coarse pointer", () => {
    renderModal();
    const label = screen.getByRole("radio", { name: "flights:bulk.tripClear" }).closest("label");
    expect(label?.className).toContain("pointer-coarse:min-h-(--ts-size-touch-min)");
  });

  it("caps the selection at 200 with the reason beside the grey confirm (review I2)", async () => {
    const many = Array.from({ length: 201 }, (_, i) => flight(`m${i}`));
    renderModal(vi.fn(), vi.fn(), many);
    await userEvent.setup().click(screen.getByRole("radio", { name: "flights:bulk.tripClear" }));
    expect(confirmButton()).toBeDisabled();
    expect(
      screen.getByRole("button", { name: 'flights:bulk.missing.tooMany {"max":200,"count":201}' })
    ).toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();
  });

  it("after a timeout says the outcome is unknown and offers a reload", async () => {
    edit.mockRejectedValueOnce(
      Object.assign(new Error("timeout of 60000ms exceeded"), {
        isAxiosError: true,
        code: "ECONNABORTED",
      })
    );
    const user = userEvent.setup();
    const { onApplied } = renderModal();
    await user.click(screen.getByRole("radio", { name: "flights:bulk.tripClear" }));
    await user.click(confirmButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("flights:bulk.outcomeUnknown");
    await user.click(screen.getByRole("button", { name: "flights:bulk.reloadList" }));
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("says so when retrying the failed ones fails as a request (review I3)", async () => {
    edit
      .mockResolvedValueOnce({
        results: [
          { flightId: "a", status: "updated" },
          { flightId: "b", status: "failed", code: "UPDATE_FAILED" },
          { flightId: "c", status: "updated" },
        ],
        summary: { updated: 2, unchanged: 0, failed: 1 },
      })
      .mockRejectedValueOnce(Object.assign(new Error("Network Error"), { isAxiosError: true }))
      .mockResolvedValueOnce({
        results: [{ flightId: "b", status: "updated" }],
        summary: { updated: 1, unchanged: 0, failed: 0 },
      });
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("radio", { name: "flights:bulk.tripClear" }));
    await user.click(confirmButton());
    await user.click(
      await screen.findByRole("button", { name: /flights:bulk\.result\.retryFailed/ })
    );
    const banner = (await screen.findByText("flights:bulk.outcomeUnknown")).closest(
      "[data-form-error-banner]"
    ) as HTMLElement;
    expect(banner).toBeInTheDocument();
    // Its retry sends the same failed ones again.
    await user.click(within(banner).getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(3));
    expect(edit).toHaveBeenLastCalledWith({ flightIds: ["b"], trip: { mode: "clear" } });
    await waitFor(() => expect(screen.queryByTestId("bulk-failed-b")).toBeNull());
  });
});
