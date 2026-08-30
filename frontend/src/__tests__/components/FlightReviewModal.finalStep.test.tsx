import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import FlightReviewModal from "../../components/FlightReviewModal";
import type { ParsedBooking } from "../../types";

/**
 * The click that writes must not look like the click that turns the page.
 *
 * Forgejo #14: reviewing a four-leg MSG import, every step was labelled
 * "Weiter" — including the fourth. That press created all four records and
 * closed the wizard. Nothing on screen separated navigation from the
 * irreversible act, so the only way to learn which was which was to do it.
 *
 * The distinction is real, not cosmetic: `handleFlightReviewConfirm` only
 * ACCUMULATES on the intermediate steps and no request leaves the browser.
 * The last step sends the whole batch in one `createBatch` call. So the final
 * button is the only one that writes, and it now says so — with the count,
 * because it commits every leg reviewed, not just the one on screen.
 */
// Same shape as FlightReviewModal.fieldSources.test.tsx — the modal reaches
// into the API, both stores and i18n on mount, none of which this test is
// about. `t` returns the KEY, so the assertions below read as keys.
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
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const booking = {
  flightNumber: "LH400",
  departureAirport: { iata: "FRA", name: "Frankfurt" },
  arrivalAirport: { iata: "JFK", name: "New York" },
  departureTime: "2024-01-15T10:00:00Z",
  arrivalTime: "2024-01-15T13:00:00Z",
} as unknown as ParsedBooking;

function renderAt(flightIndex: number | undefined, totalFlights: number | undefined) {
  return render(
    <FlightReviewModal
      isOpen
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      initialData={booking}
      source="email"
      flightIndex={flightIndex}
      totalFlights={totalFlights}
    />
  );
}

describe("FlightReviewModal — the committing step", () => {
  it("says next while there are more legs to review", () => {
    renderAt(0, 4);
    expect(screen.getByText("common:buttons.next")).toBeInTheDocument();
    expect(screen.queryByText(/review\.importAll/)).toBeNull();
  });

  it("names the write on the last leg instead of saying next", () => {
    renderAt(3, 4);
    expect(screen.getByText(/review\.importAll/)).toBeInTheDocument();
    expect(screen.queryByText("common:buttons.next")).toBeNull();
  });

  it("keeps the single-flight wording unchanged", () => {
    // One leg was never part of the complaint and must not start reading like
    // a batch import.
    renderAt(undefined, undefined);
    expect(screen.getByText("flights:review.confirm")).toBeInTheDocument();
    expect(screen.queryByText("common:buttons.next")).toBeNull();
  });
});
