import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LodgingStats } from "../../../../../types/lodging";

// Use the real settingsStore so the component reads whatever we `setState`
// below, rather than the global setup.ts mock's fixed defaults.
vi.unmock("../../../../../store/settingsStore");

// Imported after the unmock above so the module graph picks it up.
import { useSettingsStore } from "../../../../../store/settingsStore";
import { LodgingCurrencyBreakdown } from "../LodgingCurrencyBreakdown";

const baseStats: LodgingStats = {
  lodgingsCount: 2,
  staysCount: 3,
  totalNights: 11,
  nightsByYear: {},
  nightsByMonth: {},
  longestStayNights: 4,
  chainsUnique: 1,
  citiesUnique: 2,
  countries: ["DE"],
  countriesCount: 1,
  spendBaseTotal: 0,
  spendByCurrency: {},
  spendBaseByCurrency: {},
  awardNights: 0,
  nightsByType: { hotel: 11 },
  avgRatingOverall: 4.3,
  chainLoyaltyMax: 1,
  sameHotelRepeatMax: 1,
};

describe("LodgingCurrencyBreakdown", () => {
  beforeEach(() => {
    useSettingsStore.setState({ baseCurrency: "EUR" });
  });

  it("renders each original currency with its own amount and never a summed total", () => {
    const stats: LodgingStats = {
      ...baseStats,
      spendBaseTotal: 620,
      spendByCurrency: { EUR: 190, CHF: 420 },
    };

    render(<LodgingCurrencyBreakdown stats={stats} />);

    expect(screen.getByText("EUR")).toBeInTheDocument();
    expect(screen.getByText(/190/)).toBeInTheDocument();
    expect(screen.getByText("CHF")).toBeInTheDocument();
    expect(screen.getByText(/420/)).toBeInTheDocument();
    // 190 + 420 = 610 would be a meaningless cross-currency sum — must never appear.
    expect(screen.queryByText(/610/)).not.toBeInTheDocument();
  });

  it("shows the edge case where the ECB lookup failed for one stay — spendByCurrency and spendBaseTotal legitimately don't reconcile", () => {
    // A stay contributed its original CHF amount to spendByCurrency but its
    // conversion failed, so spendBaseTotal only reflects the OTHER stay.
    // Amounts are chosen so none is a substring of another.
    const stats: LodgingStats = {
      ...baseStats,
      spendBaseTotal: 77,
      spendByCurrency: { EUR: 190, CHF: 421 },
    };

    render(<LodgingCurrencyBreakdown stats={stats} />);

    // Both currency lines still render even though they don't sum to the base total.
    expect(screen.getByText(/77/)).toBeInTheDocument();
    expect(screen.getByText(/190/)).toBeInTheDocument();
    expect(screen.getByText(/421/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

  it("renders no NaN/null when spendByCurrency is empty and spendBaseTotal is zero", () => {
    render(<LodgingCurrencyBreakdown stats={baseStats} />);

    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("labels the converted total with the real baseCurrency, not units.currency", () => {
    useSettingsStore.setState({
      baseCurrency: "CHF",
      units: { distanceUnit: "kilometers", currency: "USD" },
    });
    const stats: LodgingStats = { ...baseStats, spendBaseTotal: 1234, spendByCurrency: {} };

    render(<LodgingCurrencyBreakdown stats={stats} />);

    expect(screen.getByText(/CHF/)).toBeInTheDocument();
    expect(screen.queryByText(/\$1,234/)).not.toBeInTheDocument();
  });

  // Finding 2: spendBaseTotal only covers the CURRENT base currency — a
  // stay snapshotted under an OLDER base currency must still be visible
  // somewhere, honestly labeled, rather than silently dropped.
  it("shows an older base-currency amount separately when the user has switched base currency", () => {
    useSettingsStore.setState({ baseCurrency: "CHF" });
    const stats: LodgingStats = {
      ...baseStats,
      spendBaseTotal: 300, // only the CHF-snapshotted stay
      spendBaseByCurrency: { EUR: 190, CHF: 300 },
    };

    render(<LodgingCurrencyBreakdown stats={stats} />);

    const otherBaseSection = screen.getByTestId("lodging-currency-breakdown-other-base");
    expect(otherBaseSection.textContent).toMatch(/EUR/);
    expect(otherBaseSection.textContent).toMatch(/190/);
    // The CURRENT base currency (CHF) must not appear again in the "other" section.
    expect(otherBaseSection.textContent).not.toMatch(/CHF/);
  });

  it("renders no 'other base currency' section when every snapshot matches the current base", () => {
    useSettingsStore.setState({ baseCurrency: "EUR" });
    const stats: LodgingStats = {
      ...baseStats,
      spendBaseTotal: 190,
      spendBaseByCurrency: { EUR: 190 },
    };

    render(<LodgingCurrencyBreakdown stats={stats} />);

    expect(screen.queryByTestId("lodging-currency-breakdown-other-base")).not.toBeInTheDocument();
  });
});
