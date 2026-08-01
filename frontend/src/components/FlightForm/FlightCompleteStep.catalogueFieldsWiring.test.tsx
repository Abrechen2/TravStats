/**
 * Phase 2 Task 1 characterization — pins the input→setter wiring for the
 * three catalogue-bound fields (airline, operating airline, aircraft) in the
 * CREATE form, BEFORE they move onto a catalogue picker. Must pass unedited
 * before and after the swap.
 *
 * This sits at the wiring layer deliberately (Phase 1 lesson: a payload-level
 * test on useFlightForm drives the hook's setters directly and cannot see a
 * mis-wired onChange). It renders the real component and fires real DOM
 * events on the real inputs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import FlightCompleteStep, { type FlightCompleteStepProps } from "./FlightCompleteStep";

const mocks = vi.hoisted(() => ({ companionsList: vi.fn() }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../../hooks/useSuggestions", () => ({
  useSuggestions: () => ({ airlines: [], aircraft: [] }),
}));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({ features: { enableCostTracking: false } }),
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

function baseProps(overrides: Partial<FlightCompleteStepProps> = {}): FlightCompleteStepProps {
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
    bookingClassLetter: undefined,
    baggageAllowance: undefined,
    frequentFlyerNumber: undefined,
    setBookingReference: vi.fn(),
    setTicketNumber: vi.fn(),
    setBookingClassLetter: vi.fn(),
    setBaggageAllowance: vi.fn(),
    setFrequentFlyerNumber: vi.fn(),
    cost: { price: undefined, currency: "EUR", taxes: undefined, fees: undefined, receiptUrl: "" },
    onCostChange: vi.fn(),
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

function byPlaceholder(container: HTMLElement, key: string): HTMLInputElement {
  return container.querySelector(
    `input[placeholder="flights:form.placeholders.${key}"]`
  ) as HTMLInputElement;
}

beforeEach(() => {
  mocks.companionsList.mockReset().mockResolvedValue([]);
});

describe("FlightCompleteStep catalogue-bound field wiring (Phase 2 Task 1)", () => {
  it("routes typed airline, operating airline and aircraft to their setters verbatim", () => {
    const setAirline = vi.fn();
    const setOperatingAirline = vi.fn();
    const setAircraft = vi.fn();
    const { container } = render(
      <FlightCompleteStep {...baseProps({ setAirline, setOperatingAirline, setAircraft })} />
    );

    fireEvent.change(byPlaceholder(container, "airline"), { target: { value: "Condor" } });
    fireEvent.change(byPlaceholder(container, "operatingAirline"), {
      target: { value: "Marabu" },
    });
    fireEvent.change(byPlaceholder(container, "aircraft"), {
      target: { value: "Airbus A330-900" },
    });

    expect(setAirline).toHaveBeenCalledWith("Condor");
    expect(setOperatingAirline).toHaveBeenCalledWith("Marabu");
    expect(setAircraft).toHaveBeenCalledWith("Airbus A330-900");
  });

  it("renders the current prop values into the three inputs", () => {
    const { container } = render(
      <FlightCompleteStep
        {...baseProps({
          airline: "Lufthansa",
          operatingAirline: "Lufthansa CityLine",
          aircraft: "Embraer E195",
        })}
      />
    );

    expect(byPlaceholder(container, "airline").value).toBe("Lufthansa");
    expect(byPlaceholder(container, "operatingAirline").value).toBe("Lufthansa CityLine");
    expect(byPlaceholder(container, "aircraft").value).toBe("Embraer E195");
  });
});
