import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const getNext = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/flights", () => ({ flightsApi: { getNext } }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count != null ? `${k}:${o.count}` : k),
    i18n: { language: "de" },
  }),
}));

import { NextFlightCard } from "../NextFlightCard";

const base = {
  id: "f1",
  airline: "Lufthansa",
  airlineIata: "LH",
  flightNumber: "410",
  depIata: "MUC",
  arrIata: "JFK",
  arrivalTime: null,
  depTimeSemantics: "UTC",
  arrTimeSemantics: "UTC",
  tripId: null as string | null,
  departure: { city: "München", country: "DE" },
  arrival: { city: "New York", country: "US" },
};

const renderCard = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <NextFlightCard />
    </MemoryRouter>
  );

describe("NextFlightCard (#1)", () => {
  beforeEach(() => {
    getNext.mockReset();
    navigate.mockReset();
  });

  it("renders nothing when there is no upcoming flight", async () => {
    getNext.mockResolvedValue(null);
    const { container } = renderCard();
    await waitFor(() => expect(getNext).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the route with cities and a day countdown", async () => {
    const inFive = new Date(Date.now() + 5 * 86_400_000 + 3_600_000).toISOString();
    getNext.mockResolvedValue({ ...base, departureTime: inFive });
    renderCard();

    await waitFor(() => expect(screen.getByText(/München \(MUC\)/)).toBeInTheDocument());
    expect(screen.getByText(/New York \(JFK\)/)).toBeInTheDocument();
    // count-bearing key proves the days branch fired
    expect(screen.getByText(/dashboard:nextFlight.inDays:5/)).toBeInTheDocument();
  });

  it("counts in hours on the last day", async () => {
    const inThreeHours = new Date(Date.now() + 3 * 3_600_000 + 300_000).toISOString();
    getNext.mockResolvedValue({ ...base, departureTime: inThreeHours });
    renderCard();
    await waitFor(() =>
      expect(screen.getByText(/dashboard:nextFlight.inHours:3/)).toBeInTheDocument()
    );
  });

  it("navigates to the trip when the flight has one", async () => {
    const inFive = new Date(Date.now() + 5 * 86_400_000 + 3_600_000).toISOString();
    getNext.mockResolvedValue({ ...base, departureTime: inFive, tripId: "t9" });
    renderCard();
    fireEvent.click(await screen.findByRole("button"));
    expect(navigate).toHaveBeenCalledWith("/trips/t9");
  });

  it("navigates to the flights list when there is no trip", async () => {
    const inFive = new Date(Date.now() + 5 * 86_400_000 + 3_600_000).toISOString();
    getNext.mockResolvedValue({ ...base, departureTime: inFive, tripId: null });
    renderCard();
    fireEvent.click(await screen.findByRole("button"));
    expect(navigate).toHaveBeenCalledWith("/flights");
  });
});
