/**
 * The cruise form adopts the shared form blocks (forgejo#245–#249). Before: a
 * save that sent and then printed one red line, a day without a port refused
 * by the server as "Kreuzfahrt konnte nicht gespeichert werden", fields named
 * only by their placeholder, and Escape dropping a half-typed cruise.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseEditModal } from "../CruiseEditModal";
import { cruiseApi, tripsApi, companionsApi } from "../../../lib/api";
import type { Cruise, CruiseStop } from "../../../types";

vi.mock("../../../lib/api", () => ({
  cruiseApi: { create: vi.fn(), update: vi.fn() },
  portsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  shipsApi: {
    search: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    cruiseLines: vi.fn().mockResolvedValue([]),
  },
  companionsApi: { list: vi.fn() },
  tripsApi: { getAll: vi.fn() },
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});

const stored = { id: "c-new", stops: [], tags: [], companions: [] } as unknown as Cruise;

const seaDay = (id: string, dayNumber: number): CruiseStop => ({
  id,
  cruiseId: "c1",
  portId: null,
  port: null,
  dayNumber,
  date: null,
  isAtSea: true,
  arrivalTime: null,
  departureTime: null,
  excursionNote: null,
  unresolvedPortName: null,
});

const existing = {
  id: "c1",
  cruiseLine: "AIDA",
  routeName: "Nordland",
  startDate: "2026-01-01T00:00:00.000Z",
  // Empty end date and two undated stops: the form fills all three from the
  // start date as it opens. Its own suggestions are not the user's changes.
  endDate: null,
  status: "scheduled",
  currency: "EUR",
  tags: [],
  companions: [],
  tripId: null,
  stops: [seaDay("s1", 1), seaDay("s2", 3)],
} as unknown as Cruise;

// By its text, not its role: a role query over this form is slow (review M7).
const save = (): HTMLElement => screen.getByText("form.save", { selector: "button" });
const hint = (): HTMLElement | null => screen.queryByTestId("save-blocked-hint");
const startField = (): HTMLElement => screen.getByLabelText(/^field\.startDate/);

function fillIdentityAndStart(): void {
  fireEvent.change(screen.getByLabelText("field.routeName"), { target: { value: "Nordland" } });
  fireEvent.change(startField(), { target: { value: "2026-07-01" } });
}

describe("CruiseEditModal — the shared form blocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(companionsApi.list).mockResolvedValue([]);
    vi.mocked(tripsApi.getAll).mockResolvedValue([]);
  });

  it("marks what a new cruise needs, and explains the mark", async () => {
    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    // Let the trip list settle, so nothing renders after the test.
    await act(async () => {});
    expect(startField()).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("form.identityHint")).toBeInTheDocument();
    expect(screen.getByText("common:form.requiredLegend")).toBeInTheDocument();
  });

  it("names every field by a visible label, not by its placeholder", async () => {
    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    await act(async () => {});
    for (const name of [
      "field.ship",
      "field.line",
      "field.routeName",
      "field.endDate",
      "field.cabin",
      "field.cabinType",
      "field.deck",
      "field.bookingReference",
      "field.price",
      "field.notes",
    ]) {
      const control = screen.getByLabelText(name);
      expect(control.getAttribute("aria-label")).toBeNull();
      expect(control.getAttribute("placeholder") ?? "").not.toBe(name);
    }
  });

  it("says why save is greyed out and takes the user to each gap", async () => {
    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(save()).toBeDisabled();
    expect(hint()).toHaveTextContent("cruise:form.missing.identity");
    expect(hint()).toHaveTextContent("cruise:form.missing.startDate");

    await userEvent.click(screen.getByRole("button", { name: "cruise:form.missing.startDate" }));
    expect(document.activeElement).toBe(startField());

    fillIdentityAndStart();
    expect(hint()).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it("names a day without a port, opens it from the hint, and lets a sea day settle it", async () => {
    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    fillIdentityAndStart();
    await userEvent.click(screen.getByRole("button", { name: /stops\.add/ }));
    // Close the new day again, as a user scrolling on would.
    const summary = document.querySelector<HTMLElement>("summary[id$='-summary']");
    if (summary) fireEvent.click(summary);

    expect(save()).toBeDisabled();
    expect(hint()).toHaveTextContent("cruise:form.missing.stopPort");

    await userEvent.click(screen.getByRole("button", { name: "cruise:form.missing.stopPort" }));
    const port = screen.getByLabelText("stops.port");
    expect(document.activeElement).toBe(port);
    expect(port.closest("details")?.open).toBe(true);
    expect(port.getAttribute("aria-describedby")).toBe("cruise-form-save-blocked");

    fireEvent.click(screen.getByRole("checkbox", { name: "stops.at_sea" }));
    expect(hint()).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it("closes an untouched edit form at once, though it filled its own dates", async () => {
    const onClose = vi.fn();
    render(<CruiseEditModal mode="edit" cruise={existing} onClose={onClose} onSaved={vi.fn()} />);
    await waitFor(() =>
      expect((screen.getByLabelText("field.endDate") as HTMLInputElement).value).toBe("2026-01-03")
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("common:discard.title")).not.toBeInTheDocument();
  });

  it("asks before Escape or Cancel drop a changed form", async () => {
    const onClose = vi.fn();
    render(<CruiseEditModal mode="edit" cruise={existing} onClose={onClose} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("field.cabin"), "8123");

    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("common:discard.title")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "common:discard.keepEditing" }));

    await userEvent.click(screen.getByRole("button", { name: "form.cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "common:discard.confirm" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft on a failed save, says why in a focused banner, and retries", async () => {
    vi.mocked(cruiseApi.create)
      .mockRejectedValueOnce({ isAxiosError: true, message: "Network Error" })
      .mockResolvedValueOnce(stored);
    const onSaved = vi.fn();
    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={onSaved} />);
    fillIdentityAndStart();
    await userEvent.click(save());

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("common:saveErrors.network");
    expect(screen.getByLabelText("field.routeName")).toHaveValue("Nordland");
    await waitFor(() => expect(document.activeElement).toBe(banner));

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(stored));
    expect(cruiseApi.create).toHaveBeenCalledTimes(2);
  });

  it("refuses an end before the start at the field, goes there, and sends nothing", async () => {
    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    fillIdentityAndStart();
    const end = screen.getByLabelText("field.endDate");
    fireEvent.change(end, { target: { value: "2026-06-20" } });
    await userEvent.click(save());

    expect(end).toHaveAttribute("aria-invalid", "true");
    expect(end).toHaveAccessibleDescription("cruise:form.errors.endBeforeStart");
    await waitFor(() => expect(document.activeElement).toBe(end));
    expect(cruiseApi.create).not.toHaveBeenCalled();

    fireEvent.change(end, { target: { value: "2026-07-08" } });
    expect(end).not.toHaveAttribute("aria-invalid");
  });

  it("says a stored cruise was saved when the follow-up fails, and never creates it twice", async () => {
    vi.mocked(cruiseApi.create).mockResolvedValue(stored);
    const onSaved = vi.fn().mockRejectedValue(new Error("list unavailable"));
    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={onSaved} />);
    fillIdentityAndStart();
    await userEvent.click(save());

    expect(await screen.findByText("common:form.savedButRefreshFailed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "form.save" })).toBeNull();
    expect(cruiseApi.create).toHaveBeenCalledTimes(1);
    // The editor's bookkeeping never reaches the server.
    const body = vi.mocked(cruiseApi.create).mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain("uiKey");
  });
});
