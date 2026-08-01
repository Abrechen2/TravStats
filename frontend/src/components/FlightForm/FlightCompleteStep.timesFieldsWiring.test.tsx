/**
 * Regression test for Task 3b (#199) — FlightCompleteStep's onChange wrapper
 * around <TimesFields> was hand-derived during the swap: it must re-advance
 * arrivalDate to match a NEW departure date (when arrival hasn't caught up
 * yet), but must NOT do so for any other field edit — most importantly, not
 * for a plain departure TIME edit.
 *
 * The payload-level characterization test (useFlightForm.timeSubmit.test.ts)
 * drives the hook's setters directly and never renders FlightCompleteStep,
 * so it cannot see this wiring at all. This file renders the real component
 * and fires real DOM events on the real <TimesFields> inputs.
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

beforeEach(() => {
  mocks.companionsList.mockReset().mockResolvedValue([]);
});

describe("FlightCompleteStep <-> TimesFields wiring (Task 3b)", () => {
  it("advances arrival date to match a NEW departure date when arrival hasn't caught up", () => {
    const setDepartureDate = vi.fn();
    const setArrivalDate = vi.fn();
    render(
      <FlightCompleteStep
        {...baseProps({
          departureDate: "2026-08-01",
          arrivalDate: "2026-08-01",
          setDepartureDate,
          setArrivalDate,
        })}
      />
    );

    const depDateInput = document.querySelector("#timesFieldsDepDate") as HTMLInputElement;
    fireEvent.change(depDateInput, { target: { value: "2026-08-14" } });

    expect(setDepartureDate).toHaveBeenCalledWith("2026-08-14");
    expect(setArrivalDate).toHaveBeenCalledWith("2026-08-14");
  });

  it("does NOT move the arrival date when only the departure TIME changes", () => {
    const setDepartureTime = vi.fn();
    const setArrivalDate = vi.fn();
    // Arrival strictly BEFORE departure — deliberately, to make a wrongly-
    // firing catch-up observable: if the "only on a real date change" guard
    // were lost, the catch-up condition (`arrDate < depDate`) is already
    // true here purely from the fixture, so any code path that re-evaluates
    // it on a time-only edit would immediately overwrite arrivalDate to
    // "2026-08-10". Correct behaviour never touches it.
    render(
      <FlightCompleteStep
        {...baseProps({
          departureDate: "2026-08-10",
          departureTime: "09:00",
          arrivalDate: "2026-08-05",
          setDepartureTime,
          setArrivalDate,
        })}
      />
    );

    const depTimeInput = document.querySelector("#timesFieldsDepTime") as HTMLInputElement;
    fireEvent.change(depTimeInput, { target: { value: "18:30" } });

    expect(setDepartureTime).toHaveBeenCalledWith("18:30");
    // arrivalDate must stay exactly what it was — never advanced to depDate.
    expect(setArrivalDate).toHaveBeenCalledWith("2026-08-05");
    expect(setArrivalDate).not.toHaveBeenCalledWith("2026-08-10");
  });
});
