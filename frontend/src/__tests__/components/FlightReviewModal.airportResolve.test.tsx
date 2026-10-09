import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import FlightReviewModal from "../../components/FlightReviewModal";
import type { ParsedBooking } from "../../types";

/**
 * Silent-failure review 2026-09-26, finding 16: the review dialog said
 * "Flughafen nicht gefunden" for a code the autocomplete resolves at once,
 * because it searched the text index and accepted an exact IATA hit only.
 * EDDF is Frankfurt by its ICAO code — a code that lookup could never match.
 */
const getByCode = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api/airports", () => ({ airportsApi: { getByCode } }));
// The text search the dialog used before: it finds nothing for these codes,
// which is what made the old lookup say "not found".
vi.mock("../../lib/api", () => ({
  airportsApi: { search: vi.fn().mockResolvedValue([]) },
  parseApi: { submitParserCorrection: vi.fn() },
}));
vi.mock("../../store/authStore", () => ({
  useAuthStore: () => ({ user: { id: "u1" } }),
}));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({ features: { enableCostTracking: false } }),
}));
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});
vi.mock("../../hooks/useTranslation", () => ({
  // `i18n` too: the "Zum Speichern fehlt noch" line joins its items in the
  // reader's language (forgejo#245).
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("@/lib/api/suggestions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/suggestions")>();
  return {
    ...actual,
    suggestionsApi: {
      ...actual.suggestionsApi,
      aircraft: vi.fn().mockResolvedValue([]),
      airlines: vi.fn().mockResolvedValue([]),
    },
  };
});

const FRANKFURT = { iata: "FRA", icao: "EDDF", name: "Frankfurt", lat: 50, lon: 8 };

const renderWith = (booking: Partial<ParsedBooking>) =>
  render(
    <FlightReviewModal
      isOpen
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      initialData={{ flightNumber: "LH400", missing: [], ...booking } as ParsedBooking}
      source="email"
    />
  );

describe("FlightReviewModal — airport codes resolve like the autocomplete", () => {
  it("finds an ICAO code, and names only the code the catalogue lacks", async () => {
    getByCode.mockImplementation(async (code: string) => {
      if (code === "EDDF") return FRANKFURT;
      throw Object.assign(new Error("nf"), { response: { status: 404 } });
    });
    renderWith({ departureCode: "EDDF", arrivalCode: "QQQ" });

    expect(await screen.findByText("flights:review.arrivalNotFound")).toBeInTheDocument();
    expect(screen.queryByText(/departureNotFound/)).toBeNull();
    expect(getByCode).toHaveBeenCalledWith("EDDF");
  });

  it("tells a failed load apart from a missing code", async () => {
    getByCode.mockRejectedValue(Object.assign(new Error("boom"), { response: { status: 500 } }));
    renderWith({ departureCode: "FRA" });

    expect(await screen.findByText("errors:airportLoadFailedCode")).toBeInTheDocument();
  });
});
