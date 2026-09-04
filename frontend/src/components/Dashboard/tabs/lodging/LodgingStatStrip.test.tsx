import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LodgingStats } from "../../../../types/lodging";

// Use the real settingsStore so the component reads whatever we `setState`
// below, rather than the global setup.ts mock's fixed defaults.
vi.unmock("../../../../store/settingsStore");

// Imported after the unmock above so the module graph picks it up.
import { useSettingsStore } from "../../../../store/settingsStore";
import { LodgingStatStrip } from "./LodgingStatStrip";
import { EMPTY_LODGING_STATS_BLOCKS } from "../../../../types/lodgingStatsFixture";

const stats: LodgingStats = {
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
  countriesByYear: {},
  spendBaseTotal: 1234,
  spendByCurrency: {},
  spendUnconvertedStays: 0,
  spendBaseByCurrency: { EUR: 1234 },
  awardNights: 0,
  nightsByType: { hotel: 11 },
  avgRatingOverall: 4.3,
  chainLoyaltyMax: 1,
  sameHotelRepeatMax: 1,
  plannedStaysCount: 0,
  plannedNights: 0,
  plannedLodgingsCount: 0,
  notedLodgingsCount: 0,
  ...EMPTY_LODGING_STATS_BLOCKS,
};

describe("LodgingStatStrip", () => {
  beforeEach(() => {
    // Reset to the store's own defaults before each test so state doesn't
    // leak between cases.
    useSettingsStore.setState({
      baseCurrency: "EUR",
      units: { distanceUnit: "kilometers" },
    });
  });

  it("labels the spend figure with the real baseCurrency, not a differing units.currency", () => {
    // The backend computed `spendBaseTotal` in CHF (the user's base
    // currency). The user separately set their Units→Currency display
    // preference to USD — a completely independent setting used elsewhere
    // for flight costs. The spend figure must be labeled CHF, never USD.
    useSettingsStore.setState({
      baseCurrency: "CHF",
      units: { distanceUnit: "kilometers" },
    });

    render(<LodgingStatStrip stats={stats} />);

    // Intl.NumberFormat renders CHF as "CHF 1,234" (en-US doesn't have a
    // narrow symbol for CHF) and USD as "$1,234" — so asserting on the
    // literal "CHF" substring is a precise, currency-specific check.
    expect(screen.getByText(/CHF/)).toBeInTheDocument();
    expect(screen.queryByText(/\$1,234/)).not.toBeInTheDocument();
  });

  it("renders the inline variant without absolute positioning (list-page stat strip)", () => {
    render(<LodgingStatStrip stats={stats} variant="inline" />);
    const strip = screen.getByTestId("lodging-stat-strip");
    expect(strip.getAttribute("data-variant")).toBe("inline");
    expect(strip.style.position).not.toBe("absolute");
  });

  it("shows the FX sub-line under Ausgaben when spend includes a foreign currency", () => {
    // The global react-i18next mock (src/__tests__/setup.ts) returns the raw
    // key as `t`'s output and drops interpolation params entirely — the
    // exact "840 CHF → 883 €" text (and that the converted amount is
    // DERIVED, never re-run through an FX rate client-side) is covered
    // precisely by `lib/__tests__/lodgingFormat.test.ts`'s `otherCurrencySpend`
    // tests. What's load-bearing here is the wiring: the sub-line node
    // exists exactly when there's foreign-currency spend to show.
    const withForeignSpend = {
      ...stats,
      spendBaseTotal: 2553,
      spendByCurrency: { EUR: 1670, CHF: 840 },
      spendUnconvertedStays: 0,
      spendBaseByCurrency: { EUR: 2553 },
    };

    render(<LodgingStatStrip stats={withForeignSpend} />);

    expect(screen.getByTestId("lodging-stat-strip-spend-sub")).toBeInTheDocument();
  });

  it("says how many stays the total leaves out", () => {
    // The lodging DETAIL page footnoted this from the start; the strip — the
    // same money, one screen up — stayed silent, so a total missing two stays
    // read exactly like a complete one. Keys, not prose: see the note above.
    const withUnconverted = { ...stats, spendUnconvertedStays: 2 };

    render(<LodgingStatStrip stats={withUnconverted} />);

    expect(screen.getByTestId("lodging-stat-strip-spend-sub").textContent).toContain(
      "lodging:fx.omittedFromTotal"
    );
  });

  it("shows no FX sub-line when every stay is already in the base currency", () => {
    const allBase = { ...stats, spendByCurrency: { EUR: 1234 } };

    render(<LodgingStatStrip stats={allBase} />);

    expect(screen.queryByTestId("lodging-stat-strip-spend-sub")).not.toBeInTheDocument();
  });
});
