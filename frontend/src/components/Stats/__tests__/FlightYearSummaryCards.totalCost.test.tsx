import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SummaryStats } from "../../../lib/api";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number }) =>
      opts?.count !== undefined ? `${k}:${opts.count}` : k,
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: () => ({
    units: { distanceUnit: "km", temperatureUnit: "c" },
    baseCurrency: "EUR",
  }),
}));

import FlightYearSummaryCards from "../FlightYearSummaryCards";

const summary = (over: Partial<SummaryStats>): SummaryStats => ({
  totalFlights: 3,
  totalDistance: 1000,
  totalFlightTime: 300,
  avgDistance: 333,
  byStatus: {},
  byAirline: {},
  totalCost: 1234,
  totalCostCurrency: "EUR",
  totalCostUnconverted: {},
  unpricedFlights: 0,
  byCategory: {},
  ...over,
});

// Every tile is a real `<button>` since Task 9, which needs `useSearchParams`.
const renderWith = (yearSummary: SummaryStats): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <FlightYearSummaryCards
        selectedYear={2023}
        compareYear={null}
        summaryLoading={false}
        yearSummary={yearSummary}
        compareSummary={null}
      />
    </MemoryRouter>
  );

// forgejo#83 — a year with no priced flight read "Gesamtkosten 0 €": a claim
// that the flights were free. The server abstains with null; the tile must
// show a dash and say how many flights had no price.
describe("FlightYearSummaryCards — total cost", () => {
  it("shows a dash and the unpriced count instead of 0 € when totalCost is null", () => {
    renderWith(summary({ totalCost: null, unpricedFlights: 3 }));

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("stats:overview.noPricesRecorded:3")).toBeInTheDocument();
    expect(screen.queryByText(/0[,.]00\s?€|^0\s?€/)).toBeNull();
  });

  it("formats a real total and says nothing about missing prices", () => {
    renderWith(summary({ totalCost: 1234, unpricedFlights: 0 }));

    // The thousands separator depends on the locale the test runner resolves
    // (a dot, a comma, a narrow or a plain space), so only the digits are pinned.
    expect(screen.getByText(/1\D?234/)).toBeInTheDocument();
    expect(screen.queryByText(/noPricesRecorded/)).toBeNull();
  });
});

// CT106 design-6 R09: the overview card and this tile must say the same thing
// about one 90-minute flight, in the reader's language — "1,5" on a German page.
describe("FlightYearSummaryCards — flight time", () => {
  it("prints hours with one localised decimal", () => {
    renderWith(summary({ totalFlightTime: 90 }));

    expect(screen.getByText("1,5")).toBeInTheDocument();
  });
});
