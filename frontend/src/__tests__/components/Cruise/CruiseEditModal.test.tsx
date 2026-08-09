import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseEditModal } from "../../../components/Cruise/CruiseEditModal";
import { cruiseApi, companionsApi } from "../../../lib/api";
import type { Cruise } from "../../../types";

vi.mock("../../../lib/api", () => ({
  cruiseApi: { create: vi.fn(), update: vi.fn() },
  portsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  shipsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  companionsApi: { list: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
    ready: true,
  }),
}));

describe("CruiseEditModal", () => {
  beforeEach(() => {
    vi.mocked(companionsApi.list).mockReset().mockResolvedValue([]);
  });

  // Create mode opens directly on the manual form now — email/PDF import is a
  // separate flow on the list page (DomainImportButton), so there's no longer
  // an import-vs-manual chooser step to advance past.
  it("submits a new cruise and calls onSaved", async () => {
    vi.mocked(cruiseApi.create).mockResolvedValue({
      id: "c1",
      stops: [],
      tags: [],
      companions: [],
    } as unknown as Cruise);
    const onSaved = vi.fn();

    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={onSaved} />);

    const lineInput = screen.getByLabelText("field.line");
    await userEvent.type(lineInput, "AIDA");

    await userEvent.click(screen.getByRole("button", { name: /form\.save/i }));

    await waitFor(() => expect(cruiseApi.create).toHaveBeenCalled());
    const payload = vi.mocked(cruiseApi.create).mock.calls[0][0];
    expect(payload.cruiseLine).toBe("AIDA");
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows validation errors from server", async () => {
    vi.mocked(cruiseApi.create).mockRejectedValue({
      response: { data: { error: "Invalid payload" } },
    });

    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /form\.save/i }));

    expect(await screen.findByText(/invalid payload/i)).toBeInTheDocument();
  });

  const baseCruise: Cruise = {
    id: "cruise-1",
    userId: "user-1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "AIDA",
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-08T00:00:00.000Z",
    status: "scheduled",
    color: null,
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: "EUR",
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // #status-from-dates: the cruise write paths now derive scheduled/in_progress/
  // flown from the dates — a manual select just let the UI set a value the
  // backend would immediately overwrite. Mirrors FlightEditModal's treatment.
  it("has no status select — status is a read-only pill plus a Storniert checkbox (#status-from-dates)", () => {
    const { container } = render(
      <CruiseEditModal mode="edit" cruise={baseCruise} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    expect(container.querySelector('select[aria-label="field.status"]')).toBeFalsy();
    // The pill renders the raw i18n key under the globally-mocked t(key) => key.
    expect(container.textContent).toContain("status.scheduled");
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(false);
  });

  it('checking the Storniert checkbox submits status "cancelled"', async () => {
    vi.mocked(cruiseApi.update).mockResolvedValue({ ...baseCruise, status: "cancelled" });
    const onSaved = vi.fn();
    const { container } = render(
      <CruiseEditModal mode="edit" cruise={baseCruise} onClose={vi.fn()} onSaved={onSaved} />
    );
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await userEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /form\.save/i }));

    await waitFor(() => expect(cruiseApi.update).toHaveBeenCalled());
    const calls = vi.mocked(cruiseApi.update).mock.calls;
    const payload = calls[calls.length - 1][1];
    expect(payload.status).toBe("cancelled");
  });

  it('unchecking the Storniert checkbox on an already-cancelled cruise submits status "scheduled" (backend re-derives)', async () => {
    const cancelledCruise: Cruise = { ...baseCruise, status: "cancelled" };
    vi.mocked(cruiseApi.update).mockResolvedValue({ ...baseCruise, status: "scheduled" });
    const onSaved = vi.fn();
    const { container } = render(
      <CruiseEditModal mode="edit" cruise={cancelledCruise} onClose={vi.fn()} onSaved={onSaved} />
    );
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    await userEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /form\.save/i }));

    await waitFor(() => expect(cruiseApi.update).toHaveBeenCalled());
    const calls = vi.mocked(cruiseApi.update).mock.calls;
    const payload = calls[calls.length - 1][1];
    expect(payload.status).toBe("scheduled");
  });

  // Task 12 — the comma-separated companions text input is replaced by the
  // shared CompanionPicker.
  it("renders existing companions as removable chips instead of a CSV text field", () => {
    const cruiseWithCompanions: Cruise = { ...baseCruise, companions: ["Anna", "Jonas"] };
    render(
      <CruiseEditModal mode="edit" cruise={cruiseWithCompanions} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    expect(screen.getByTestId("companion-remove-Anna")).toBeInTheDocument();
    expect(screen.getByTestId("companion-remove-Jonas")).toBeInTheDocument();
  });

  it("submits companions as a string[] built from the picker chips", async () => {
    vi.mocked(cruiseApi.create).mockResolvedValue({
      id: "c1",
      stops: [],
      tags: [],
      companions: [],
    } as unknown as Cruise);

    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.type(
      screen.getByRole("combobox", { name: "picker.label" }),
      "Marie{Enter}"
    );
    await userEvent.click(screen.getByRole("button", { name: /form\.save/i }));

    await waitFor(() => expect(cruiseApi.create).toHaveBeenCalled());
    const calls = vi.mocked(cruiseApi.create).mock.calls;
    const payload = calls[calls.length - 1][0];
    expect(payload.companions).toEqual(["Marie"]);
  });

  // Clearing must be an explicit null on the wire — undefined tells the
  // server "keep the old value", which made blanking any optional detail
  // field a silent no-op in edit mode (same defect family the flight edit
  // modal had; fixed for cruises 2026-08-02).
  it("submits null, not undefined, for blanked optional fields in edit mode", async () => {
    const filled: Cruise = {
      ...baseCruise,
      cruiseLine: "AIDA",
      routeName: "Kanaren",
      cabinNumber: "8123",
      cabinType: "balcony",
      deck: 8,
      bookingReference: "ABC123",
      price: 1999.99,
      notes: "to be removed",
    };
    vi.mocked(cruiseApi.update).mockResolvedValue(baseCruise);
    render(<CruiseEditModal mode="edit" cruise={filled} onClose={vi.fn()} onSaved={vi.fn()} />);

    // Blank every optional text/number field and reset the cabin-type select.
    for (const label of [
      "field.line",
      "field.routeName",
      "field.cabin",
      "field.deck",
      "field.bookingReference",
      "field.price",
      "field.notes",
    ]) {
      await userEvent.clear(screen.getByLabelText(label));
    }
    await userEvent.selectOptions(screen.getByLabelText("field.cabinType"), "");

    await userEvent.click(screen.getByRole("button", { name: /form\.save/i }));

    await waitFor(() => expect(cruiseApi.update).toHaveBeenCalled());
    const clearCalls = vi.mocked(cruiseApi.update).mock.calls;
    const payload = clearCalls[clearCalls.length - 1][1];
    expect(payload.cruiseLine).toBeNull();
    expect(payload.routeName).toBeNull();
    expect(payload.cabinNumber).toBeNull();
    expect(payload.cabinType).toBeNull();
    expect(payload.deck).toBeNull();
    expect(payload.bookingReference).toBeNull();
    expect(payload.price).toBeNull();
    expect(payload.notes).toBeNull();
  });

  it("submits an empty stops array when the user removed every stop", async () => {
    const withStop: Cruise = {
      ...baseCruise,
      stops: [
        {
          id: "stop-1",
          cruiseId: "cruise-1",
          dayNumber: 1,
          isAtSea: true,
          portId: null,
          port: null,
          unresolvedPortName: null,
          date: null,
          arrivalTime: null,
          departureTime: null,
          excursionNote: null,
        },
      ],
    };
    vi.mocked(cruiseApi.update).mockResolvedValue(baseCruise);
    render(<CruiseEditModal mode="edit" cruise={withStop} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "stops.remove" }));
    await userEvent.click(screen.getByRole("button", { name: /form\.save/i }));

    await waitFor(() => expect(cruiseApi.update).toHaveBeenCalled());
    const stopCalls = vi.mocked(cruiseApi.update).mock.calls;
    const payload = stopCalls[stopCalls.length - 1][1];
    // [] deletes all stops server-side; undefined would silently keep them.
    expect(payload.stops).toEqual([]);
  });
});
