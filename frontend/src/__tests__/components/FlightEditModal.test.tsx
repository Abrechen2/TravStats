import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FlightEditModal from "../../components/FlightEditModal";
import type { Flight } from "../../types";

const mocks = vi.hoisted(() => ({ companionsList: vi.fn() }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/ReceiptUpload", () => ({
  default: () => null,
}));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({
    features: { enableCostTracking: false },
  }),
}));
vi.mock("../../lib/api", () => ({
  companionsApi: { list: mocks.companionsList },
}));

const mockFlight: Flight = {
  id: "1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH123",
  depLat: 50.033,
  depLon: 8.571,
  arrLat: 48.354,
  arrLon: 11.786,
  departureTime: "2026-06-01T10:00:00.000Z",
  arrivalTime: "2026-06-01T11:00:00.000Z",
  status: "flown",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("FlightEditModal", () => {
  beforeEach(() => {
    mocks.companionsList.mockReset().mockResolvedValue([]);
  });

  it("renders separate date and time inputs for both departure and arrival when modal is open", () => {
    render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    // Four distinct controls, not two combined datetime-local fields.
    expect(document.querySelector("#editDepartureDate")).toBeTruthy();
    expect(document.querySelector("#editDepartureTime")).toBeTruthy();
    expect(document.querySelector("#editArrivalDate")).toBeTruthy();
    expect(document.querySelector("#editArrivalTime")).toBeTruthy();
    expect(document.querySelector('#editDepartureDate[type="date"]')).toBeTruthy();
    expect(document.querySelector('#editDepartureTime[type="time"]')).toBeTruthy();
  });

  it("pre-fills departure date and time from flight data", () => {
    render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    const dateInput = document.querySelector("#editDepartureDate") as HTMLInputElement;
    const timeInput = document.querySelector("#editDepartureTime") as HTMLInputElement;
    // Values are formatted in local timezone — just verify they're not empty.
    expect(dateInput?.value).toBeTruthy();
    expect(timeInput?.value).toBeTruthy();
  });

  it("shows year/month picker instead of date/time inputs for historical flights", () => {
    const historicalFlight: Flight = {
      ...mockFlight,
      status: "historical",
      departureTime: null,
      arrivalTime: null,
    };
    render(
      <FlightEditModal flight={historicalFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    // date/time inputs should not be present
    expect(document.querySelector("#editDepartureDate")).toBeFalsy();
    expect(document.querySelector("#editDepartureTime")).toBeFalsy();
    expect(document.querySelector("#editArrivalDate")).toBeFalsy();
    expect(document.querySelector("#editArrivalTime")).toBeFalsy();
    // year number input should be present
    expect(document.querySelector('input[type="text"][inputmode="numeric"]')).toBeTruthy();
  });

  // Task 3 follow-up: clearing/setting the historical year used to touch only
  // the departure fields and leave the arrival ones stale (an asymmetry bug
  // pre-dating the date/time split). The split's rewrite made both directions
  // symmetric — this pins that behaviour so it can't silently regress back to
  // the old asymmetry.
  it("clearing the historical year clears departure AND arrival date+time together", async () => {
    const historicalFlight: Flight = {
      ...mockFlight,
      status: "historical",
      // Noon UTC on two different dates so the split-vs-not-split difference
      // is unambiguous regardless of the test runner's local timezone.
      departureTime: "2020-03-15T12:00:00.000Z",
      arrivalTime: "2020-03-20T12:00:00.000Z",
    };
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(
      <FlightEditModal flight={historicalFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );

    const yearInput = document.querySelector("#editHistoricalYear") as HTMLInputElement;
    expect(yearInput.value).toBe("2020");

    fireEvent.change(yearInput, { target: { value: "" } });
    expect(yearInput.value).toBe("");

    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    // Old (asymmetric) behaviour left arrivalLocal/arrTimezone populated —
    // asserting all four are gone is what catches a regression back to it.
    expect(updates.departureLocal).toBeUndefined();
    expect(updates.depTimezone).toBeUndefined();
    expect(updates.arrivalLocal).toBeUndefined();
    expect(updates.arrTimezone).toBeUndefined();
  });

  it("setting the historical year (with no prior date) sets departure AND arrival together", async () => {
    const historicalFlight: Flight = {
      ...mockFlight,
      status: "historical",
      departureTime: null,
      arrivalTime: null,
    };
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(
      <FlightEditModal flight={historicalFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );

    const yearInput = document.querySelector("#editHistoricalYear") as HTMLInputElement;
    expect(yearInput.value).toBe("");

    fireEvent.change(yearInput, { target: { value: "2019" } });
    expect(yearInput.value).toBe("2019");

    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    // Both sides land on the same year-01-01 shape — proving arrival was set
    // in the same action as departure, not left behind.
    expect(updates.departureLocal).toBe("2019-01-01T00:00");
    expect(updates.arrivalLocal).toBe("2019-01-01T00:00");
    expect(updates.depTimezone).toBeTruthy();
    expect(updates.arrTimezone).toBeTruthy();
  });

  it("always shows price + currency but hides taxes/fees when enableCostTracking is false (#192)", () => {
    const { container } = render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    // Exactly ONE number field with the flag off: the price. Taxes and fees
    // (the other two step-0.01 inputs) stay behind the cost-tracking toggle.
    const numberInputs = container.querySelectorAll('input[type="number"][step="0.01"]');
    expect(numberInputs.length).toBe(1);
    expect((numberInputs[0] as HTMLInputElement).placeholder).toBe(
      "flights:form.placeholders.price"
    );
  });

  it("has no status select — status is a read-only pill plus a cancelled checkbox (#status-from-dates)", () => {
    const { container } = render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    // The old status <select> had flown/scheduled/cancelled/historical options.
    // "flown" only ever appeared as a status option value, so its absence proves
    // the combobox is gone.
    expect(container.querySelector('option[value="flown"]')).toBeFalsy();
    // The pill renders the raw i18n key under the globally-mocked t(key) => key.
    expect(container.textContent).toContain("flights:status.flown");
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(false);
  });

  it("renders the historical pill in amber, not red — historical is archival data, not an error", () => {
    const historicalFlight: Flight = { ...mockFlight, status: "historical" };
    const { container } = render(
      <FlightEditModal flight={historicalFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    const pill = container.querySelector(".rounded-full") as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.style.color).toBe("rgb(251, 191, 36)");
  });

  it("renders the duplicated pill in amber, not red", () => {
    const duplicatedFlight: Flight = { ...mockFlight, status: "duplicated" };
    const { container } = render(
      <FlightEditModal flight={duplicatedFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    const pill = container.querySelector(".rounded-full") as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.style.color).toBe("rgb(251, 191, 36)");
  });

  it("checking the cancelled checkbox submits status \"cancelled\"", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.status).toBe("cancelled");
  });

  it('unchecking the cancelled checkbox on an already-cancelled flight submits status "scheduled" (backend re-derives)', async () => {
    const cancelledFlight: Flight = { ...mockFlight, status: "cancelled" };
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = render(
      <FlightEditModal flight={cancelledFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.status).toBe("scheduled");
  });

  // Phase 2 Task 1 characterization — pins the typed-text round trip for the
  // three catalogue-bound fields BEFORE they move onto a catalogue picker.
  // Must pass unedited before and after the swap: the picker changes how a
  // value can be chosen, never what a typed value submits as.
  it("submits the typed airline, operating airline and aircraft verbatim", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );
    const byPlaceholder = (key: string): HTMLInputElement =>
      container.querySelector(
        `input[placeholder="flights:form.placeholders.${key}"]`
      ) as HTMLInputElement;

    fireEvent.change(byPlaceholder("airline"), { target: { value: "Condor" } });
    fireEvent.change(byPlaceholder("operatingAirline"), { target: { value: "Marabu" } });
    fireEvent.change(byPlaceholder("aircraft"), { target: { value: "Airbus A330-900" } });

    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.airline).toBe("Condor");
    expect(updates.operatingAirline).toBe("Marabu");
    expect(updates.aircraft).toBe("Airbus A330-900");
  });

  it("submits a cleared airline as undefined (field omitted), not as an empty string", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );
    const airlineInput = container.querySelector(
      'input[placeholder="flights:form.placeholders.airline"]'
    ) as HTMLInputElement;
    expect(airlineInput.value).toBe("LH");

    fireEvent.change(airlineInput, { target: { value: "" } });
    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.airline).toBeUndefined();
  });

  // Phase 2 Task 2 characterization — pins the typed booking-reference and
  // ticket-number round trip BEFORE both move into the shared BookingFields.
  // Must pass unedited before and after the swap. The typed reference is
  // deliberately already uppercase: the create form uppercases on input and
  // the swap aligns the edit form onto that behaviour, so a lowercase fixture
  // would pin the asymmetry this phase exists to remove.
  it("submits the typed booking reference and ticket number verbatim", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );
    const byPlaceholder = (key: string): HTMLInputElement =>
      container.querySelector(
        `input[placeholder="flights:form.placeholders.${key}"]`
      ) as HTMLInputElement;

    fireEvent.change(byPlaceholder("bookingReference"), { target: { value: "9RFAA7" } });
    fireEvent.change(byPlaceholder("ticketNumber"), { target: { value: "2202236084346" } });

    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.bookingReference).toBe("9RFAA7");
    expect(updates.ticketNumber).toBe("2202236084346");
  });

  // Phase 2 Task 2 — the three fields the parser fills and no form ever
  // showed. The untouched-save assertion is the load-bearing one: these
  // arrive pre-filled, and a form that silently blanks a field it merely
  // displayed would destroy data on every save.
  it("renders the three parser-filled booking fields and an untouched save submits them unchanged", async () => {
    const parsedFlight: Flight = {
      ...mockFlight,
      bookingClassLetter: "Y",
      baggageAllowance: "23 kg",
      frequentFlyerNumber: "992223334",
    };
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = render(
      <FlightEditModal flight={parsedFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );
    const byPlaceholder = (key: string): HTMLInputElement =>
      container.querySelector(
        `input[placeholder="flights:form.placeholders.${key}"]`
      ) as HTMLInputElement;

    expect(byPlaceholder("bookingClassLetter").value).toBe("Y");
    expect(byPlaceholder("baggageAllowance").value).toBe("23 kg");
    expect(byPlaceholder("frequentFlyerNumber").value).toBe("992223334");

    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.bookingClassLetter).toBe("Y");
    expect(updates.baggageAllowance).toBe("23 kg");
    expect(updates.frequentFlyerNumber).toBe("992223334");
  });

  it("submits an edited baggage allowance, and omits the three fields when absent and untouched", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );
    const baggageInput = container.querySelector(
      'input[placeholder="flights:form.placeholders.baggageAllowance"]'
    ) as HTMLInputElement;
    expect(baggageInput.value).toBe("");

    fireEvent.change(baggageInput, { target: { value: "2 x 32 kg" } });
    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.baggageAllowance).toBe("2 x 32 kg");
    // The other two were never filled and never touched — they must be
    // omitted, not sent as empty strings.
    expect(updates.bookingClassLetter).toBeUndefined();
    expect(updates.frequentFlyerNumber).toBeUndefined();
  });

  // Phase 2 Task 3 characterization — pins the price round trip BEFORE the
  // cost fields move into the shared CostFields. Must pass unedited before
  // and after the swap.
  it("submits a typed price as a number, and no price at all when the field is empty", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container, getByText } = render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );
    const priceInput = container.querySelector(
      'input[placeholder="flights:form.placeholders.price"]'
    ) as HTMLInputElement;

    fireEvent.change(priceInput, { target: { value: "199.99" } });
    fireEvent.click(getByText("flights:edit.saveChanges"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1].price).toBe(199.99);

    onSave.mockClear();
    fireEvent.change(priceInput, { target: { value: "" } });
    fireEvent.click(getByText("flights:edit.saveChanges"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // An empty price is OMITTED — the modal's empty-means-0 internal state
    // must never leak a stored 0 into the flight.
    expect(onSave.mock.calls[0][1].price).toBeUndefined();
  });

  // Task 12 — the comma-separated companions text input is replaced by the
  // shared CompanionPicker.
  it("renders the existing companions as removable chips instead of a CSV text field", () => {
    const flightWithCompanions: Flight = { ...mockFlight, companions: ["Anna", "Jonas"] };
    render(
      <FlightEditModal
        flight={flightWithCompanions}
        isOpen={true}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByTestId("companion-remove-Anna")).toBeInTheDocument();
    expect(screen.getByTestId("companion-remove-Jonas")).toBeInTheDocument();
  });

  // Phase 2 Task 5 — the parsed co-passengers surface beside the picker,
  // and taking them over flows into the SUBMITTED companions.
  it("shows parsed co-passengers and take-over copies them into the saved companions", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const parsedFlight: Flight = {
      ...mockFlight,
      companions: ["Anna"],
      coPassengers: ["Jonas Weber"],
    };
    const { getByText } = render(
      <FlightEditModal flight={parsedFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );

    expect(screen.getByTestId("co-passengers-row").textContent).toContain("Jonas Weber");
    fireEvent.click(screen.getByTestId("co-passengers-take-over"));
    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.companions).toEqual(["Anna", "Jonas Weber"]);
  });

  it("submits companions as a string[] built from the picker chips", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const flightWithCompanions: Flight = { ...mockFlight, companions: ["Anna"] };
    const { getByText } = render(
      <FlightEditModal
        flight={flightWithCompanions}
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );

    await userEvent.type(screen.getByRole("combobox", { name: "picker.label" }), "Jonas{Enter}");
    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.companions).toEqual(["Anna", "Jonas"]);
  });
});
