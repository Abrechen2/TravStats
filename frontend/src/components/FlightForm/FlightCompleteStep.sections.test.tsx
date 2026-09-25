/**
 * forgejo#88, point 9 — the manual flight form asks for the core first.
 *
 * Three things are pinned here, and each of them is invisible in a diff once
 * it is wrong:
 *
 * - **The required marks are there before anything is submitted.** The old
 *   form said what was missing only after a refused save, in one sentence that
 *   named no field.
 * - **Only the core opens.** A `defaultOpen` slipped onto the wrong section
 *   would restore exactly the wall of 25 inputs this replaced, and every
 *   field-wiring test in the folder would still pass, because jsdom renders a
 *   closed `<details>`'s children.
 * - **A closed section says what is in it.** Folding is only safe while the
 *   fold cannot hide a price.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, type RenderResult } from "@testing-library/react";
import FlightCompleteStep, { type FlightCompleteStepProps } from "./FlightCompleteStep";

const mocks = vi.hoisted(() => ({ companionsList: vi.fn() }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
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

const section = (container: HTMLElement, id: string): HTMLDetailsElement =>
  container.querySelector(`details[data-section="${id}"]`) as HTMLDetailsElement;

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.companionsList.mockReset().mockResolvedValue([]);
});

describe("FlightCompleteStep — required marks and folded sections (forgejo#88)", () => {
  it("opens the core and folds the other three, before anything is touched", async () => {
    const { container } = await renderStep(baseProps());

    expect(section(container, "core").open).toBe(true);
    expect(section(container, "priceAndSeat").open).toBe(false);
    expect(section(container, "aircraft").open).toBe(false);
    expect(section(container, "booking").open).toBe(false);
  });

  it("marks the four scheduled time fields as required from first render", async () => {
    const { container } = await renderStep(baseProps());

    // The two airport inputs are mocked away here; what this file owns is the
    // date/time pair, which had no marking at all before.
    const required = container.querySelectorAll('input[aria-required="true"]');
    expect(required).toHaveLength(4);
    expect(Array.from(required).map((input) => input.getAttribute("type"))).toEqual([
      "date",
      "time",
      "date",
      "time",
    ]);
  });

  it("explains the asterisk rather than leaving it to be guessed", async () => {
    const { container } = await renderStep(baseProps());
    expect(container.textContent).toContain("flights:form.requiredLegend");
  });

  it("does not mark the ACTUAL times — they are optional by design", async () => {
    const { container } = await renderStep(
      baseProps({
        actualDepartureDate: "",
        actualDepartureTime: "",
        actualArrivalDate: "",
        actualArrivalTime: "",
        setActualDepartureDate: vi.fn(),
        setActualDepartureTime: vi.fn(),
        setActualArrivalDate: vi.fn(),
        setActualArrivalTime: vi.fn(),
      })
    );

    expect(container.querySelectorAll('input[aria-required="true"]')).toHaveLength(4);
  });

  it("names what a folded section holds", async () => {
    const { container } = await renderStep(
      baseProps({
        cost: { ...EMPTY_COST, price: 120 },
        seatNumber: "14A",
        aircraft: "A320",
        bookingReference: "XYZ123",
      })
    );

    const price = section(container, "priceAndSeat").querySelector("summary")!.textContent ?? "";
    expect(price).toContain("120 EUR");
    expect(price).toContain("14A");

    expect(section(container, "aircraft").querySelector("summary")!.textContent).toContain("A320");
    expect(section(container, "booking").querySelector("summary")!.textContent).toContain("XYZ123");
  });

  it("says nothing about a folded section that holds nothing", async () => {
    const { container } = await renderStep(baseProps());

    // Only the section's own title — no "Preis: " with an empty value, and no
    // sentence about the section being empty.
    const summary = section(container, "priceAndSeat").querySelector("summary")!;
    expect(summary.textContent).toBe("flights:form.sections.priceAndSeat");
  });

  it("remembers an opened section for the rest of the session", async () => {
    const { container, unmount } = await renderStep(baseProps());

    const details = section(container, "aircraft");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    unmount();

    const { container: reopened } = await renderStep(baseProps());
    expect(section(reopened, "aircraft").open).toBe(true);
    // And only that one — remembering must not open everything.
    expect(section(reopened, "booking").open).toBe(false);
  });
});
