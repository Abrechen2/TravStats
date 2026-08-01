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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FlightCompleteStep, { type FlightCompleteStepProps } from "./FlightCompleteStep";

const mocks = vi.hoisted(() => ({ companionsList: vi.fn() }));

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
vi.mock("../../lib/api", () => ({
  companionsApi: { list: mocks.companionsList },
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
    setTags: vi.fn(),
    setCompanions: vi.fn(),
    notes: "",
    setNotes: vi.fn(),
    textClass: "",
    mutedTextClass: "",
    sizedInputClass: "",
    setTimeEstimationWarning: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.companionsList.mockReset().mockResolvedValue([]);
});

describe("FlightCompleteStep companions field (Task 12)", () => {
  it("renders the shared CompanionPicker instead of a plain comma-separated input", () => {
    render(<FlightCompleteStep {...baseProps()} />);
    expect(screen.getByRole("combobox", { name: "picker.label" })).toBeInTheDocument();
  });

  it("threads an existing companions array through as removable chips", () => {
    render(<FlightCompleteStep {...baseProps({ companions: ["Anna", "Jonas"] })} />);
    expect(screen.getByTestId("companion-remove-Anna")).toBeInTheDocument();
    expect(screen.getByTestId("companion-remove-Jonas")).toBeInTheDocument();
  });

  it("calls setCompanions with the full string[] when a new companion is entered", async () => {
    const setCompanions = vi.fn();
    render(<FlightCompleteStep {...baseProps({ companions: ["Anna"], setCompanions })} />);
    await userEvent.type(screen.getByRole("combobox", { name: "picker.label" }), "Jonas{Enter}");
    expect(setCompanions).toHaveBeenCalledWith(["Anna", "Jonas"]);
  });
});

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

  it("renders the historical pill in amber, not red — historical is archival data, not an error", () => {
    const { container } = render(<FlightCompleteStep {...baseProps({ status: "historical" })} />);
    const pill = container.querySelector(".rounded-full") as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.style.color).toBe("rgb(251, 191, 36)");
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
