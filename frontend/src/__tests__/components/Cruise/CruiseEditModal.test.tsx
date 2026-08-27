import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseEditModal } from "../../../components/Cruise/CruiseEditModal";
import { cruiseApi, companionsApi, tripsApi } from "../../../lib/api";
import type { Cruise, Trip } from "../../../types";

vi.mock("../../../lib/api", () => ({
  cruiseApi: { create: vi.fn(), update: vi.fn() },
  portsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  shipsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  companionsApi: { list: vi.fn() },
  tripsApi: { getAll: vi.fn() },
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
    vi.mocked(tripsApi.getAll).mockReset().mockResolvedValue([]);
  });

  // Create mode opens directly on the manual form now — email/PDF import is a
  // the first route in the add-dialog (DomainImportPanel), so there's no longer
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

  // Cruise → Trip assignment (#general, 2026-08-26: "How do I link a cruise
  // to a Journey?"). Every other domain already offers this — flights via
  // TripSelectField, stays via StayEditor's select, place visits via
  // PlaceDetailPage — and the whole chain below the form was already built:
  // Cruise.tripId exists, Zod accepts it on create and update, and the PUT
  // handler recomputes the status of BOTH the old and the new trip. Only the
  // control was missing, so a cruise could be linked through the API and by
  // the import preview, but never by hand.
  //
  // Unlike flights, the assignment goes in the cruise's OWN payload: a flight
  // reaches its trip through tripsApi.assignFlights after the save, because
  // Flight.tripId is owned by the Trip relation. Cruise.tripId is owned by the
  // cruise, exactly like LodgingStay.tripId, so the select feeds the payload.
  describe("trip assignment", () => {
    const trips = [
      { id: "trip-1", name: "Mittelmeer 2026" },
      { id: "trip-2", name: "Karibik 2027" },
    ] as unknown as Trip[];

    it("lists the user's trips and preselects the one the cruise belongs to", async () => {
      vi.mocked(tripsApi.getAll).mockResolvedValue(trips);
      const linked: Cruise = { ...baseCruise, tripId: "trip-2" };

      render(<CruiseEditModal mode="edit" cruise={linked} onClose={vi.fn()} onSaved={vi.fn()} />);

      const select = await screen.findByLabelText("field.trip");
      await waitFor(() => expect(screen.getByRole("option", { name: "Karibik 2027" })).toBeInTheDocument());
      expect(screen.getByRole("option", { name: "Mittelmeer 2026" })).toBeInTheDocument();
      expect((select as HTMLSelectElement).value).toBe("trip-2");
    });

    it("submits the chosen tripId", async () => {
      vi.mocked(tripsApi.getAll).mockResolvedValue(trips);
      vi.mocked(cruiseApi.update).mockResolvedValue(baseCruise);

      render(<CruiseEditModal mode="edit" cruise={baseCruise} onClose={vi.fn()} onSaved={vi.fn()} />);

      const select = await screen.findByLabelText("field.trip");
      await waitFor(() => expect(screen.getByRole("option", { name: "Mittelmeer 2026" })).toBeInTheDocument());
      await userEvent.selectOptions(select, "trip-1");

      await userEvent.click(screen.getByRole("button", { name: /form\.save/i }));

      await waitFor(() => expect(cruiseApi.update).toHaveBeenCalled());
      const calls = vi.mocked(cruiseApi.update).mock.calls;
      expect(calls[calls.length - 1][1].tripId).toBe("trip-1");
    });

    // The same explicit-clear rule the rest of this form follows: undefined
    // tells the server "keep the old value", so unlinking has to send null or
    // it is a silent no-op and the cruise stays on the trip.
    it("submits null, not undefined, when the cruise is unlinked from its trip", async () => {
      vi.mocked(tripsApi.getAll).mockResolvedValue(trips);
      vi.mocked(cruiseApi.update).mockResolvedValue(baseCruise);
      const linked: Cruise = { ...baseCruise, tripId: "trip-1" };

      render(<CruiseEditModal mode="edit" cruise={linked} onClose={vi.fn()} onSaved={vi.fn()} />);

      const select = await screen.findByLabelText("field.trip");
      await waitFor(() => expect(screen.getByRole("option", { name: "Mittelmeer 2026" })).toBeInTheDocument());
      await userEvent.selectOptions(select, "");

      await userEvent.click(screen.getByRole("button", { name: /form\.save/i }));

      await waitFor(() => expect(cruiseApi.update).toHaveBeenCalled());
      const calls = vi.mocked(cruiseApi.update).mock.calls;
      expect(calls[calls.length - 1][1].tripId).toBeNull();
    });

    // Non-fatal on purpose, mirroring TripSelectField: a failed trip list must
    // not take the whole edit dialog down. The field just offers "no trip".
    it("still renders the form when the trip list fails to load", async () => {
      vi.mocked(tripsApi.getAll).mockRejectedValue(new Error("network"));

      render(<CruiseEditModal mode="edit" cruise={baseCruise} onClose={vi.fn()} onSaved={vi.fn()} />);

      expect(await screen.findByLabelText("field.trip")).toBeInTheDocument();
      expect(screen.getByLabelText("field.line")).toBeInTheDocument();
    });
  });
});
