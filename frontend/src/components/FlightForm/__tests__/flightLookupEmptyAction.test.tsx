import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

// The flight forms ask the user's logbook for suggestions over the network;
// these tests pin other wiring and must reach none.
vi.mock("@/hooks/useFlightEntrySuggestions", () => ({
  useFlightEntrySuggestions: () => ({
    seats: [],
    flightNumbers: [],
    frequentFlyerNumber: null,
    departureTerminals: [],
  }),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// The step lazily loads the drop zone and the boarding-pass scanner; neither is
// what this file is about, and both reach for the network on mount.
vi.mock("../../import/EmailImportTab", () => ({ default: () => null }));
vi.mock("../../BoardingPassScanner", () => ({ default: () => null }));

import FlightLookupStep from "../FlightLookupStep";

/**
 * forgejo#88 finding 8 — the flight-number search says what it needs.
 *
 * "Suchen" on an empty field did nothing at all when the audit tried it. The
 * button is correctly `disabled` now, so the silent no-op is gone, but nothing
 * said what was missing — and the row already had room for a hint, because it
 * carries one about the date.
 *
 * The two hints are mutually exclusive on purpose: "no flight number" is what
 * blocks the search, "no date" only makes it worse, and showing both at once
 * would bury the one that matters.
 */
const props = {
  flightNumber: "",
  searchDate: "",
  loading: false,
  showScanner: false,
  sizedInputClass: "",
  setFlightNumber: vi.fn(),
  setSearchDate: vi.fn(),
  setShowScanner: vi.fn(),
  setStep: vi.fn(),
  setError: vi.fn(),
  handleFlightLookup: vi.fn(async () => undefined),
  handleBoardingPassScan: vi.fn(async () => undefined),
  setImportBatchId: vi.fn(),
  setParsedFlights: vi.fn(),
  setCurrentFlightIndex: vi.fn(),
  setParserProvider: vi.fn(),
  setOriginalEmailData: vi.fn(),
  setShowFlightReview: vi.fn(),
};

/**
 * Awaited render: the step's drop zone and scanner arrive through `lazy`, so
 * Suspense resolves them a microtask after the first paint. A bare `render`
 * leaves that update outside act(...), which the suite's guard fails on.
 */
const renderStep = async (overrides: Partial<typeof props> = {}): Promise<void> => {
  await act(async () => {
    render(<FlightLookupStep {...props} {...overrides} />);
  });
};

describe("FlightLookupStep — the flight-number search explains itself when empty", () => {
  it("names the missing flight number, and keeps the search refused", async () => {
    await renderStep();

    expect(screen.getByText("flights:form.flightNumberRequired")).toBeTruthy();
    expect(screen.getByRole("button", { name: "flights:form.searchFlight" })).toBeDisabled();
    // Not the date hint — the search cannot run at all yet.
    expect(screen.queryByText("flights:form.dateImproves")).toBeNull();
  });

  it("hands over to the date hint once a flight number is there", async () => {
    await renderStep({ flightNumber: "LH400" });

    expect(screen.queryByText("flights:form.flightNumberRequired")).toBeNull();
    expect(screen.getByText("flights:form.dateImproves")).toBeTruthy();
    expect(screen.getByRole("button", { name: "flights:form.searchFlight" })).not.toBeDisabled();
  });

  it("shows no hint at all once both fields are filled", async () => {
    await renderStep({ flightNumber: "LH400", searchDate: "2026-09-19" });

    expect(screen.queryByText("flights:form.flightNumberRequired")).toBeNull();
    expect(screen.queryByText("flights:form.dateImproves")).toBeNull();
  });

  it("treats whitespace as no flight number", async () => {
    await renderStep({ flightNumber: "  " });

    expect(screen.getByText("flights:form.flightNumberRequired")).toBeTruthy();
    expect(screen.getByRole("button", { name: "flights:form.searchFlight" })).toBeDisabled();
  });
});
