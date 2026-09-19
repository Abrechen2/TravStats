import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";
import type { TripCostSuperlative } from "../../../lib/api/trips";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

import { TripInsightsBar } from "../TripInsightsBar";

const trip = (over: Partial<Trip>): Trip =>
  ({
    id: "t",
    name: "Trip",
    countries: [],
    flights: [],
    cruises: [],
    bookings: [],
    lodgingStays: [],
    ...over,
  }) as Trip;

const render_ = (
  trips: Trip[],
  mostExpensiveTrip: TripCostSuperlative | null = null
): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <TripInsightsBar trips={trips} mostExpensiveTrip={mostExpensiveTrip} />
    </MemoryRouter>
  );

describe("TripInsightsBar (#3)", () => {
  it("renders nothing when no metric has a winner", () => {
    const { container } = render_([trip({})]);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the winning trip names and navigates on click", () => {
    render_(
      [
        trip({ id: "wide", name: "Grand Tour", countries: ["DE", "US", "JP"] }),
        trip({ id: "rich", name: "Luxe", bookings: [{ price: 9000, currency: "EUR" }] as never }),
      ],
      {
        tripId: "rich",
        name: "Luxe",
        amount: 9000,
        currency: "EUR",
        excluded: { count: 0, reason: "unconvertible" },
      }
    );
    expect(screen.getByText("Grand Tour")).toBeInTheDocument();
    expect(screen.getByText("Luxe")).toBeInTheDocument();
    // No exclusion note at count 0 — see the next test for count > 0.
    expect(screen.queryByText("trips:insights.mostExpensiveExcluded")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Grand Tour"));
    expect(navigate).toHaveBeenCalledWith("/trips/wide");
  });

  it("shows the exclusion note when some trips could not be compared (fix round 1, finding 2)", () => {
    render_(
      [trip({ id: "rich", name: "Luxe", bookings: [{ price: 9000, currency: "EUR" }] as never })],
      {
        tripId: "rich",
        name: "Luxe",
        amount: 9000,
        currency: "EUR",
        excluded: { count: 2, reason: "unconvertible" },
      }
    );
    // The mocked `useTranslation` returns the bare key, ignoring
    // interpolation — this asserts the LINE is rendered, not its final copy
    // (covered by the DE/EN JSON resources + the locale-parity test).
    expect(screen.getByText("trips:insights.mostExpensiveExcluded")).toBeInTheDocument();
  });
});
