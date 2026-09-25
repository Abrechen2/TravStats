/**
 * The create form offers what the user's own logbook knows (entry
 * suggestions): chips under the flight number, seat and terminal, and a
 * frequent flyer number filled in for an airline booked before — but only
 * into an empty field.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState, type JSX } from "react";
import { act, fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import FlightCompleteStep, { type FlightCompleteStepProps } from "./FlightCompleteStep";

const mocks = vi.hoisted(() => ({
  companionsList: vi.fn(),
  suggestions: vi.fn(),
}));

vi.mock("@/hooks/useFlightEntrySuggestions", () => ({
  useFlightEntrySuggestions: mocks.suggestions,
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => (opts?.value ? `${key}:${opts.value}` : key),
    i18n: { language: "en" },
  }),
}));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({ features: { enableCostTracking: false } }),
}));
vi.mock("../../store/toastStore", () => ({ useToastStore: vi.fn(() => vi.fn()) }));
vi.mock("../../lib/geo", () => ({ calculateDistance: vi.fn(() => 1000) }));
vi.mock("../../lib/timeEstimation", () => ({ estimateArrivalFromDeparture: vi.fn() }));
vi.mock("../../lib/api", () => ({ companionsApi: { list: mocks.companionsList } }));
vi.mock("../Help/HelpIcon", () => ({ default: () => null }));
vi.mock("../AirportAutocomplete", () => ({ default: () => null }));
vi.mock("./CopyActionButton", () => ({ default: () => null }));
vi.mock("../common/CurrencySelect", () => ({ default: () => null }));
vi.mock("../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("@/lib/api/trips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/trips")>();
  return { ...actual, tripsApi: { ...actual.tripsApi, getAll: vi.fn().mockResolvedValue([]) } };
});

const EMPTY_COST = {
  price: undefined,
  currency: "EUR",
  taxes: undefined,
  fees: undefined,
  receiptUrl: "",
};

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
    boardingGroup: "",
    seatClass: "",
    status: "scheduled",
    category: "",
    setAirline: vi.fn(),
    setOperatingAirline: vi.fn(),
    setFlightNumber: vi.fn(),
    setAircraft: vi.fn(),
    setTerminal: vi.fn(),
    setGate: vi.fn(),
    setSeatNumber: vi.fn(),
    setBoardingGroup: vi.fn(),
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
    cost: EMPTY_COST,
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

/**
 * Render and let the two children that fetch on mount settle.
 *
 * `TripSelectField` loads the trip list and `CompanionPicker` the companions;
 * both resolve after the first paint, and asserting before they do measures an
 * intermediate render — which the suite's act ratchet refuses outright.
 */
const renderStep = async (props: FlightCompleteStepProps): Promise<RenderResult> => {
  let view!: RenderResult;
  await act(async () => {
    view = render(<FlightCompleteStep {...props} />);
  });
  return view;
};

const chip = (value: string): HTMLElement =>
  screen.getByRole("button", { name: `common:suggestionChip:${value}` });

const MUC = { iata: "MUC", name: "Munich", lat: 48.35, lon: 11.79 };
const CPH = { iata: "CPH", name: "Copenhagen", lat: 55.62, lon: 12.66 };

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.companionsList.mockReset().mockResolvedValue([]);
  mocks.suggestions.mockReset().mockReturnValue({
    seats: ["12A", "3C"],
    flightNumbers: ["LH2440"],
    frequentFlyerNumber: "992000111",
    departureTerminals: ["2"],
  });
});

describe("FlightCompleteStep — entry suggestions", () => {
  it("asks with the marketing airline and both route ends", async () => {
    await renderStep(
      baseProps({ airline: "Lufthansa", operatingAirline: "SAS", departure: MUC, arrival: CPH })
    );
    expect(mocks.suggestions).toHaveBeenLastCalledWith({
      airline: "Lufthansa",
      dep: "MUC",
      arr: "CPH",
    });
  });

  it("offers flight number, seat and terminal as chips that fill the field", async () => {
    const props = baseProps();
    await renderStep(props);

    fireEvent.click(chip("LH2440"));
    expect(props.setFlightNumber).toHaveBeenCalledWith("LH2440");
    fireEvent.click(chip("3C"));
    expect(props.setSeatNumber).toHaveBeenCalledWith("3C");
    fireEvent.click(chip("2"));
    expect(props.setTerminal).toHaveBeenCalledWith("2");
  });

  it("fills an empty frequent flyer number with the one last booked", async () => {
    const props = baseProps({ airline: "Lufthansa" });
    await renderStep(props);
    expect(props.setFrequentFlyerNumber).toHaveBeenCalledWith("992000111");
  });

  it("never overwrites a frequent flyer number that is already there", async () => {
    const props = baseProps({ airline: "Lufthansa", frequentFlyerNumber: "MY-OWN" });
    await renderStep(props);
    expect(props.setFrequentFlyerNumber).not.toHaveBeenCalled();
  });

  it("says a filled-in number is a suggestion, and stops saying so once edited", async () => {
    function Stateful(): JSX.Element {
      const [ffn, setFfn] = useState("");
      return (
        <FlightCompleteStep
          {...baseProps({
            airline: "Lufthansa",
            frequentFlyerNumber: ffn,
            setFrequentFlyerNumber: setFfn,
          })}
        />
      );
    }
    let view!: RenderResult;
    await act(async () => {
      view = render(<Stateful />);
    });
    const input = screen.getByDisplayValue("992000111");
    expect(view.container.textContent).toContain("flights:form.frequentFlyerSuggested");

    fireEvent.change(input, { target: { value: "992000999" } });
    expect(view.container.textContent).not.toContain("flights:form.frequentFlyerSuggested");
  });
});
