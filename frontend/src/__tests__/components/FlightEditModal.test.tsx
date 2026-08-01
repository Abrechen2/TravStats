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

  it("renders departure and arrival time inputs when modal is open", () => {
    render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect(document.querySelector("#editDepartureTime")).toBeTruthy();
    expect(document.querySelector("#editArrivalTime")).toBeTruthy();
  });

  it("pre-fills departure time from flight data", () => {
    render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    const input = document.querySelector("#editDepartureTime") as HTMLInputElement;
    // Value is formatted in local timezone — just verify it's not empty
    expect(input?.value).toBeTruthy();
  });

  it("shows year/month picker instead of datetime for historical flights", () => {
    const historicalFlight: Flight = {
      ...mockFlight,
      status: "historical",
      departureTime: null,
      arrivalTime: null,
    };
    render(
      <FlightEditModal flight={historicalFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    // datetime-local inputs should not be present
    expect(document.querySelector("#editDepartureTime")).toBeFalsy();
    // year number input should be present
    expect(document.querySelector('input[type="text"][inputmode="numeric"]')).toBeTruthy();
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
