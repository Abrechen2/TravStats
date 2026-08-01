/**
 * Phase 2 Task 3 characterization — pins the input→setter wiring for price
 * in the CREATE form, BEFORE the cost fields move into a shared CostFields
 * component. Must pass unedited before and after the swap.
 *
 * The empty-price pin matters most: the create form keeps `undefined` for an
 * empty price (the edit modal maps empty to 0 internally and strips it on
 * submit). The extraction must not collapse that into a stored 0.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import FlightCompleteStep, { type FlightCompleteStepProps } from "./FlightCompleteStep";

const mocks = vi.hoisted(() => ({ companionsList: vi.fn() }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
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

function priceInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector(
    'input[placeholder="flights:form.placeholders.price"]'
  ) as HTMLInputElement;
}

beforeEach(() => {
  mocks.companionsList.mockReset().mockResolvedValue([]);
});

describe("FlightCompleteStep cost field wiring (Phase 2 Task 3)", () => {
  it("routes a typed price to its setter as a number", () => {
    const setPrice = vi.fn();
    const { container } = render(<FlightCompleteStep {...baseProps({ setPrice })} />);

    fireEvent.change(priceInput(container), { target: { value: "199.99" } });

    expect(setPrice).toHaveBeenCalledWith(199.99);
  });

  it("routes a cleared price as undefined, never 0", () => {
    const setPrice = vi.fn();
    const { container } = render(
      <FlightCompleteStep {...baseProps({ price: 199.99, setPrice })} />
    );

    fireEvent.change(priceInput(container), { target: { value: "" } });

    expect(setPrice).toHaveBeenCalledWith(undefined);
  });

  it("renders the current price prop, and an empty input for undefined", () => {
    const { container: withPrice } = render(
      <FlightCompleteStep {...baseProps({ price: 42.5 })} />
    );
    expect(priceInput(withPrice).value).toBe("42.5");

    const { container: withoutPrice } = render(
      <FlightCompleteStep {...baseProps({ price: undefined })} />
    );
    expect(priceInput(withoutPrice).value).toBe("");
  });
});
