import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

import StatsYearFilter from "../StatsYearFilter";

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

const renderWith = (yearSummary: SummaryStats): ReturnType<typeof render> =>
  render(
    <StatsYearFilter
      availableYears={[2023, 2024]}
      selectedYear={2023}
      compareYear={null}
      compareEnabled={false}
      summaryLoading={false}
      yearSummary={yearSummary}
      compareSummary={null}
      onSelectedYearChange={() => {}}
      onCompareYearChange={() => {}}
      onCompareEnabledChange={() => {}}
    />
  );

// forgejo#83 — a year with no priced flight read "Gesamtkosten 0 €": a claim
// that the flights were free. The server abstains with null; the tile must
// show a dash and say how many flights had no price.
describe("StatsYearFilter — total cost", () => {
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
