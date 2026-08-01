/**
 * Phase 2 Task 2 characterization — pins the input→setter wiring for the
 * booking reference and ticket number in the CREATE form, BEFORE both move
 * into the shared BookingFields component. Must pass unedited before and
 * after the swap.
 *
 * Note the uppercase pin: the create form uppercases the booking reference
 * on input (a PNR is canonically uppercase). That behaviour must survive
 * the extraction — and the edit form gains it in the same move, removing
 * one of the asymmetries #199 is about.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import FlightCompleteStep, { type FlightCompleteStepProps } from "./FlightCompleteStep";

const mocks = vi.hoisted(() => ({ companionsList: vi.fn() }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
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
    tripId: "",
    setTripId: vi.fn(),
    tags: [],
    companions: [],
    coPassengers: [],
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

describe("FlightCompleteStep booking field wiring (Phase 2 Task 2)", () => {
  it("routes the typed ticket number to its setter verbatim and UPPERCASES the booking reference", () => {
    const setBookingReference = vi.fn();
    const setTicketNumber = vi.fn();
    const { container } = render(
      <FlightCompleteStep {...baseProps({ setBookingReference, setTicketNumber })} />
    );

    fireEvent.change(byPlaceholder(container, "bookingReference"), {
      target: { value: "9rfaa7" },
    });
    fireEvent.change(byPlaceholder(container, "ticketNumber"), {
      target: { value: "2202236084346" },
    });

    expect(setBookingReference).toHaveBeenCalledWith("9RFAA7");
    expect(setTicketNumber).toHaveBeenCalledWith("2202236084346");
  });

  it("renders the current prop values into both inputs", () => {
    const { container } = render(
      <FlightCompleteStep
        {...baseProps({ bookingReference: "9RFAA7", ticketNumber: "2202236084346" })}
      />
    );

    expect(byPlaceholder(container, "bookingReference").value).toBe("9RFAA7");
    expect(byPlaceholder(container, "ticketNumber").value).toBe("2202236084346");
  });
});
