import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

/**
 * The trip card hid its total behind `enableCostTracking`, while the trip
 * DETAIL page renders the same total ungated. Same trip, two answers: the card
 * said "—" where the detail page said "EUR 2832".
 *
 * Since 2.4.0 (#192) the toggle gates the taxes/fees BREAKDOWN and the business
 * statistics — not whether a price is shown at all. The card was still on the
 * old semantics.
 */
const settings = vi.hoisted(() => ({
  value: {
    features: { enableCostTracking: false },
    // TripCard also reaches the store through useEnabledDomains.
    enabledDomains: ["flight", "cruise"],
  },
}));

vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) =>
    selector ? selector(settings.value) : settings.value,
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "de" },
  }),
}));

import TripCard from "../TripCard";

const trip = {
  id: "t1",
  name: "Kostenprobe",
  status: "completed",
  countries: ["Germany"],
  bookings: [{ id: "b1", pnr: "AB12CD", price: 2832, currency: "EUR" }],
  flights: [],
  cruises: [],
  tags: [],
  category: null,
  color: null,
  coverImageUrl: null,
  destinationLabel: null,
  startDate: null,
  endDate: null,
  _count: { flights: 2, cruises: 0 },
} as unknown as Trip;

describe("TripCard cost tile", () => {
  beforeEach(() => {
    settings.value = { features: { enableCostTracking: false }, enabledDomains: ["flight", "cruise"] };
  });

  it("shows the total even when cost TRACKING is switched off", () => {
    render(
      <MemoryRouter>
        <TripCard trip={trip} onOpen={() => {}} onEdit={() => {}} onDelete={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/2\.?832/)).toBeInTheDocument();
  });

  it("shows the total when cost tracking is on, too", () => {
    settings.value = { features: { enableCostTracking: true }, enabledDomains: ["flight", "cruise"] };
    render(
      <MemoryRouter>
        <TripCard trip={trip} onOpen={() => {}} onEdit={() => {}} onDelete={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/2\.?832/)).toBeInTheDocument();
  });

  it("still shows a dash when the trip genuinely carries no price", () => {
    const free = { ...trip, bookings: [], flights: [] } as unknown as Trip;
    render(
      <MemoryRouter>
        <TripCard trip={free} onOpen={() => {}} onEdit={() => {}} onDelete={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/2\.?832/)).not.toBeInTheDocument();
  });
});
