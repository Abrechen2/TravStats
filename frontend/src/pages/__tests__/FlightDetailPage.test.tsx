/**
 * The page exists so a flight can be READ. Until now the only way to see the
 * ~50 fields the table has no column for was to open the edit form — reading
 * meant putting the record into an editable state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Flight } from "../../types";

const getByIdMock = vi.fn();

vi.mock("../../lib/api", () => ({
  flightsApi: {
    getById: (...args: unknown[]) => getByIdMock(...args),
    update: vi.fn(),
    delete: vi.fn(),
  },
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/FlightEditModal", () => ({ default: () => null }));
vi.mock("../../components/SpecialFlightModal", () => ({ default: () => null }));

import FlightDetailPage from "../FlightDetailPage";

function makeFlight(over: Partial<Flight> = {}): Flight {
  return {
    id: "f1",
    airline: "Lufthansa",
    flightNumber: "LH2462",
    depIata: "MUC",
    arrIata: "CPH",
    depLat: 48,
    depLon: 11,
    arrLat: 55,
    arrLon: 12,
    departureTime: "2026-12-21T18:06:00.000Z",
    arrivalTime: "2026-12-21T19:36:00.000Z",
    status: "scheduled",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as Flight;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/flights/f1"]}>
      <Routes>
        <Route path="/flights/:id" element={<FlightDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("FlightDetailPage", () => {
  beforeEach(() => {
    getByIdMock.mockReset();
  });

  it("shows the fields the table has no column for", async () => {
    getByIdMock.mockResolvedValue(
      makeFlight({
        seatNumber: "34D",
        gate: "B24",
        terminal: "1",
        bookingReference: "XY7Z9Q",
        baggageAllowance: "1 x 23 kg",
      })
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("34D")).toBeInTheDocument());
    expect(screen.getByText("B24")).toBeInTheDocument();
    expect(screen.getByText("XY7Z9Q")).toBeInTheDocument();
    expect(screen.getByText("1 x 23 kg")).toBeInTheDocument();
  });

  it("leaves out a card that has nothing to say", async () => {
    // A flight with no booking details at all should not render an empty
    // "Buchung & Sitz" heading over a blank box.
    getByIdMock.mockResolvedValue(makeFlight());
    renderPage();

    await waitFor(() => expect(screen.getByText(/LH2462/)).toBeInTheDocument());
    expect(screen.queryByText("flights:detail.booking")).not.toBeInTheDocument();
  });

  it("says the flight could not be loaded, rather than that it does not exist", async () => {
    // A network drop says nothing about whether the record exists — the same
    // distinction the cruise and lodging detail pages now make.
    getByIdMock.mockRejectedValue(new Error("Network Error"));
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("flights:detail.loadError");
    expect(screen.getByRole("button", { name: "common:buttons.retry" })).toBeInTheDocument();
  });

  it("offers no retry when the flight is genuinely gone", async () => {
    const notFound = Object.assign(new Error("Not Found"), {
      isAxiosError: true,
      response: { status: 404 },
    });
    getByIdMock.mockRejectedValue(notFound);
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("flights:detail.notFound");
    expect(screen.queryByRole("button", { name: "common:buttons.retry" })).not.toBeInTheDocument();
  });
});
