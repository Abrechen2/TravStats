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
// Breakdown ON in this file — the other FlightCompleteStep suites mock it
// off. The price pins below don't depend on the flag either way.
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({ features: { enableCostTracking: true } }),
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

function priceInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector(
    'input[placeholder="flights:form.placeholders.price"]'
  ) as HTMLInputElement;
}

beforeEach(() => {
  mocks.companionsList.mockReset().mockResolvedValue([]);
});

const EMPTY_COST = {
  price: undefined,
  currency: "EUR",
  taxes: undefined,
  fees: undefined,
  receiptUrl: "",
};

describe("FlightCompleteStep cost field wiring (Phase 2 Task 3)", () => {
  it("routes a typed price out as a number", () => {
    const onCostChange = vi.fn();
    const { container } = render(<FlightCompleteStep {...baseProps({ onCostChange })} />);

    fireEvent.change(priceInput(container), { target: { value: "199.99" } });

    expect(onCostChange).toHaveBeenCalledWith({ ...EMPTY_COST, price: 199.99 });
  });

  it("routes a cleared price as undefined, never 0", () => {
    const onCostChange = vi.fn();
    const { container } = render(
      <FlightCompleteStep {...baseProps({ cost: { ...EMPTY_COST, price: 199.99 }, onCostChange })} />
    );

    fireEvent.change(priceInput(container), { target: { value: "" } });

    expect(onCostChange).toHaveBeenCalledWith({ ...EMPTY_COST, price: undefined });
  });

  // Phase 2 Task 3 — new create-form surface: with cost tracking enabled the
  // create form now offers the tax/fee breakdown and the receipt upload,
  // which previously existed only when editing.
  it("renders taxes, fees and the receipt upload in the create form (cost tracking on)", () => {
    const onCostChange = vi.fn();
    const { container } = render(<FlightCompleteStep {...baseProps({ onCostChange })} />);

    const taxesInput = container.querySelector(
      'input[placeholder="flights:form.placeholders.taxes"]'
    ) as HTMLInputElement;
    expect(taxesInput).toBeTruthy();
    expect(
      container.querySelector('input[placeholder="flights:form.placeholders.fees"]')
    ).toBeTruthy();
    expect(container.querySelector('input[type="file"]')).toBeTruthy();

    fireEvent.change(taxesInput, { target: { value: "30.5" } });
    expect(onCostChange).toHaveBeenCalledWith({ ...EMPTY_COST, taxes: 30.5 });
  });

  it("renders the current price value, and an empty input for undefined", () => {
    const { container: withPrice } = render(
      <FlightCompleteStep {...baseProps({ cost: { ...EMPTY_COST, price: 42.5 } })} />
    );
    expect(priceInput(withPrice).value).toBe("42.5");

    const { container: withoutPrice } = render(<FlightCompleteStep {...baseProps()} />);
    expect(priceInput(withoutPrice).value).toBe("");
  });
});
