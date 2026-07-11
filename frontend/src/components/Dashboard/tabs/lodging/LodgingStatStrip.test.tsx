import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LodgingStats } from "../../../../types/lodging";

// Use the real settingsStore so the component reads whatever we `setState`
// below, rather than the global setup.ts mock's fixed defaults.
vi.unmock("../../../../store/settingsStore");

// Imported after the unmock above so the module graph picks it up.
import { useSettingsStore } from "../../../../store/settingsStore";
import { LodgingStatStrip } from "./LodgingStatStrip";

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
  spendBaseTotal: 1234,
  spendByCurrency: {},
  awardNights: 0,
  hotelNights: 11,
  campsiteNights: 0,
  avgRatingOverall: 4.3,
  chainLoyaltyMax: 1,
  sameHotelRepeatMax: 1,
};

describe("LodgingStatStrip", () => {
  beforeEach(() => {
    // Reset to the store's own defaults before each test so state doesn't
    // leak between cases.
    useSettingsStore.setState({
      baseCurrency: "EUR",
      units: { distanceUnit: "kilometers", currency: "EUR" },
    });
  });

  it("labels the spend figure with the real baseCurrency, not a differing units.currency", () => {
    // The backend computed `spendBaseTotal` in CHF (the user's base
    // currency). The user separately set their Units→Currency display
    // preference to USD — a completely independent setting used elsewhere
    // for flight costs. The spend figure must be labeled CHF, never USD.
    useSettingsStore.setState({
      baseCurrency: "CHF",
      units: { distanceUnit: "kilometers", currency: "USD" },
    });

    render(<LodgingStatStrip stats={stats} />);

    // Intl.NumberFormat renders CHF as "CHF 1,234" (en-US doesn't have a
    // narrow symbol for CHF) and USD as "$1,234" — so asserting on the
    // literal "CHF" substring is a precise, currency-specific check.
    expect(screen.getByText(/CHF/)).toBeInTheDocument();
    expect(screen.queryByText(/\$1,234/)).not.toBeInTheDocument();
  });
});
