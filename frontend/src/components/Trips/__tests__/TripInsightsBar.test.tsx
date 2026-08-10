import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

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
  ({ id: "t", name: "Trip", countries: [], flights: [], cruises: [], bookings: [], lodgingStays: [], ...over }) as Trip;

const render_ = (trips: Trip[]): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <TripInsightsBar trips={trips} />
    </MemoryRouter>
  );

describe("TripInsightsBar (#3)", () => {
  it("renders nothing when no metric has a winner", () => {
    const { container } = render_([trip({})]);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the winning trip names and navigates on click", () => {
    render_([
      trip({ id: "wide", name: "Grand Tour", countries: ["DE", "US", "JP"] }),
      trip({ id: "rich", name: "Luxe", bookings: [{ price: 9000, currency: "EUR" }] as never }),
    ]);
    expect(screen.getByText("Grand Tour")).toBeInTheDocument();
    expect(screen.getByText("Luxe")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Grand Tour"));
    expect(navigate).toHaveBeenCalledWith("/trips/wide");
  });
});
