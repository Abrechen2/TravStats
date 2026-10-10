import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

/**
 * The trip card hid its total behind `enableCostTracking`, while the trip
 * DETAIL page renders the same total ungated. Same trip, two answers: the card
 * said "—" where the detail page said "EUR 2832" (the detail page's own
 * spelling at the time; since forgejo#86 both go through `formatCurrency`
 * and read "2.832 €").
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
  // The server's figure (forgejo#274) — the card reads it, it sums nothing.
  cost: { spendByCurrency: { EUR: 2832 }, unpricedEntries: 0 },
} as unknown as Trip;

describe("TripCard cost tile", () => {
  beforeEach(() => {
    settings.value = {
      features: { enableCostTracking: false },
      enabledDomains: ["flight", "cruise"],
    };
  });

  it("shows the total even when cost TRACKING is switched off", () => {
    render(
      <MemoryRouter>
        <TripCard trip={trip} onOpen={() => {}} />
      </MemoryRouter>
    );
    expect(screen.getByText(/2\.?832/)).toBeInTheDocument();
  });

  it("shows the total when cost tracking is on, too", () => {
    settings.value = {
      features: { enableCostTracking: true },
      enabledDomains: ["flight", "cruise"],
    };
    render(
      <MemoryRouter>
        <TripCard trip={trip} onOpen={() => {}} />
      </MemoryRouter>
    );
    expect(screen.getByText(/2\.?832/)).toBeInTheDocument();
  });

  it("still shows a dash when the trip genuinely carries no price", () => {
    const free = {
      ...trip,
      bookings: [],
      cost: { spendByCurrency: {}, unpricedEntries: 0 },
    } as unknown as Trip;
    render(
      <MemoryRouter>
        <TripCard trip={free} onOpen={() => {}} />
      </MemoryRouter>
    );
    expect(screen.queryByText(/2\.?832/)).not.toBeInTheDocument();
  });

  // forgejo#274: the card used to rebuild the total from the rows it held —
  // a flight's bare price, never a train or a rental — and could print a
  // figure the "most expensive trip" tile beside it contradicted.
  it("shows the server's cost, not a sum of the rows the card happens to hold", () => {
    const disagreeing = {
      ...trip,
      bookings: [{ id: "b1", pnr: "AB12CD", price: 999, currency: "EUR" }],
      cost: { spendByCurrency: { EUR: 1130, CHF: 210 }, unpricedEntries: 0 },
    } as unknown as Trip;
    render(
      <MemoryRouter>
        <TripCard trip={disagreeing} onOpen={() => {}} />
      </MemoryRouter>
    );
    expect(screen.getByText(/1\.?130.*\+.*210/)).toBeInTheDocument();
    expect(screen.getByText(/1\.?130/).textContent).not.toContain("≥");
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
  });

  it("says when an entry has no price instead of reading it as free", () => {
    const partial = {
      ...trip,
      cost: { spendByCurrency: { EUR: 300 }, unpricedEntries: 2 },
    } as unknown as Trip;
    render(
      <MemoryRouter>
        <TripCard trip={partial} onOpen={() => {}} />
      </MemoryRouter>
    );
    const figure = screen.getByText(/300/);
    // Said inside the card link for a screen reader, not as a hover title
    // (forgejo#249); the card is one link, so no nested help button.
    expect(figure).toHaveTextContent("trips:costUnpriced");
    // Visible on a touch screen too, where no tooltip ever shows.
    expect(figure.textContent).toMatch(/^≥ 300/);
  });
});
