/**
 * Regression test for the status-from-dates block (Task 7) — the flight
 * status <select> (flown/scheduled/cancelled/historical) is replaced by a
 * read-only status pill plus a "Storniert"/"Cancelled" checkbox. Checking it
 * sends status "cancelled"; unchecking sends "scheduled" and the backend
 * re-derives flown/scheduled from the dates.
 *
 * FlightCompleteStep is a pure presentational component — `status` and
 * `setStatus` are props, not local state — so this also covers the
 * return-leg/copy-flow risk: the checkbox always reflects whatever `status`
 * the parent hook (useFlightForm) currently holds, never a stale local copy.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import FlightCompleteStep, { type FlightCompleteStepProps } from "./FlightCompleteStep";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../../hooks/useSuggestions", () => ({
  useSuggestions: () => ({ airlines: [], aircraft: [] }),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: vi.fn(() => vi.fn()),
}));
vi.mock("../../lib/geo", () => ({
  calculateDistance: vi.fn(() => 1000),
}));
vi.mock("../../lib/timeEstimation", () => ({
  estimateArrivalFromDeparture: vi.fn(),
}));
vi.mock("../Help/HelpIcon", () => ({ default: () => null }));
vi.mock("../AirportAutocomplete", () => ({ default: () => null }));
vi.mock("./CopyActionButton", () => ({ default: () => null }));
vi.mock("../CurrencyInput", () => ({ default: () => null }));

function baseProps(
  overrides: Partial<FlightCompleteStepProps> = {}
): FlightCompleteStepProps {
  return {
    selectedFlight: null,
    timeEstimationWarning: null,
    departure: null,
    arrival: null,
    setDeparture: vi.fn(),
    setArrival: vi.fn(),
    departureDate: "",
    departureTime: "",
    arrivalDate: "",
    arrivalTime: "",
    setDepartureDate: vi.fn(),
    setDepartureTime: vi.fn(),
    setArrivalDate: vi.fn(),
    setArrivalTime: vi.fn(),
    airline: "",
    operatingAirline: "",
    flightNumber: "",
    aircraft: "",
    terminal: "",
    gate: "",
    seatNumber: "",
    seatClass: "economy",
    status: "scheduled",
    category: "business",
    setAirline: vi.fn(),
    setOperatingAirline: vi.fn(),
    setFlightNumber: vi.fn(),
    setAircraft: vi.fn(),
    setTerminal: vi.fn(),
    setGate: vi.fn(),
    setSeatNumber: vi.fn(),
    setSeatClass: vi.fn(),
    setStatus: vi.fn(),
    setCategory: vi.fn(),
    bookingReference: "",
    ticketNumber: "",
    setBookingReference: vi.fn(),
    setTicketNumber: vi.fn(),
    price: undefined,
    currency: "EUR",
    setPrice: vi.fn(),
    setCurrency: vi.fn(),
    tags: [],
    companions: [],
    companionInput: "",
    setTags: vi.fn(),
    setCompanions: vi.fn(),
    setCompanionInput: vi.fn(),
    notes: "",
    setNotes: vi.fn(),
    textClass: "",
    mutedTextClass: "",
    sizedInputClass: "",
    setTimeEstimationWarning: vi.fn(),
    ...overrides,
  };
}

describe("FlightCompleteStep status field", () => {
  it("has no status select — flown/scheduled/cancelled/historical options are gone", () => {
    const { container } = render(<FlightCompleteStep {...baseProps()} />);
    expect(container.querySelector('option[value="flown"]')).toBeFalsy();
  });

  it("shows the status as a read-only pill using the flights:status.* label", () => {
    const { container } = render(<FlightCompleteStep {...baseProps({ status: "flown" })} />);
    // t is mocked as key => key, so the raw i18n key surfaces in the pill text.
    expect(container.textContent).toContain("flights:status.flown");
  });

  it('shows an unchecked cancelled checkbox for status "scheduled"', () => {
    const { getByLabelText } = render(<FlightCompleteStep {...baseProps({ status: "scheduled" })} />);
    // Two checkboxes exist (historical + cancelled) — target by its label so
    // this doesn't accidentally grab the unrelated "historical" checkbox.
    const checkbox = getByLabelText("flights:status.cancelledCheckbox") as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(false);
  });

  it('checking the cancelled checkbox calls setStatus("cancelled")', () => {
    const setStatus = vi.fn();
    const { getByLabelText } = render(
      <FlightCompleteStep {...baseProps({ status: "scheduled", setStatus })} />
    );
    const checkbox = getByLabelText("flights:status.cancelledCheckbox") as HTMLInputElement;
    checkbox.click();
    expect(setStatus).toHaveBeenCalledWith("cancelled");
  });

  it('unchecking the cancelled checkbox calls setStatus("scheduled") — the backend re-derives flown/scheduled from dates', () => {
    const setStatus = vi.fn();
    const { getByLabelText } = render(
      <FlightCompleteStep {...baseProps({ status: "cancelled", setStatus })} />
    );
    const checkbox = getByLabelText("flights:status.cancelledCheckbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    checkbox.click();
    expect(setStatus).toHaveBeenCalledWith("scheduled");
  });

  it("reflects the status prop directly — no stale local state across a return-leg re-render", () => {
    const setStatus = vi.fn();
    const { getByLabelText, rerender } = render(
      <FlightCompleteStep {...baseProps({ status: "flown", setStatus })} />
    );
    let checkbox = getByLabelText("flights:status.cancelledCheckbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    // Simulate the parent hook's status changing underneath this component
    // (e.g. prepareReturnFlightForm resetting the form for the return leg).
    rerender(<FlightCompleteStep {...baseProps({ status: "cancelled", setStatus })} />);
    checkbox = getByLabelText("flights:status.cancelledCheckbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});
