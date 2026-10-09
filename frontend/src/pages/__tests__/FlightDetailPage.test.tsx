/**
 * The page exists so a flight can be READ. Until now the only way to see the
 * ~50 fields the table has no column for was to open the edit form — reading
 * meant putting the record into an editable state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Flight } from "../../types";

const getByIdMock = vi.fn();

// The documents section fetches its entry's kept originals on mount. It has
// its own suite, and `__tests__/documentsMountPoints.test.tsx` checks that
// this surface mounts it — here it would only be a request reaching the
// network, which the setup refuses (forgejo#110).
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));

// The delete dialog counts the kept originals that cascade with the flight.
// The section above is stubbed out, so this mock serves the COUNT only.
const listForEntryMock = vi.fn();
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...args: unknown[]) => listForEntryMock(...args) },
}));

vi.mock("../../lib/api", () => ({
  flightsApi: {
    getById: (...args: unknown[]) => getByIdMock(...args),
    getTrack: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    delete: vi.fn(),
  },
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));

// The booking and its segments (forgejo#218) — its own API module.
const getBookingMock = vi.fn();
vi.mock("../../lib/api/flightBooking", () => ({
  flightBookingApi: { get: (...args: unknown[]) => getBookingMock(...args) },
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
    getBookingMock.mockReset();
    listForEntryMock.mockReset();
    listForEntryMock.mockResolvedValue([]);
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

  it("compares plan and record per end, and says an unrecorded time is unknown (forgejo#216)", async () => {
    getByIdMock.mockResolvedValue(
      makeFlight({
        times: {
          departure: {
            utc: "2026-12-21T18:06:00.000Z",
            local: "2026-12-21T19:06:00",
            zone: "Europe/Berlin",
            offset: "+01:00",
            precision: "minute",
          },
          arrival: {
            utc: "2026-12-21T19:36:00.000Z",
            local: "2026-12-21T20:36:00",
            zone: "Europe/Copenhagen",
            offset: "+01:00",
            precision: "minute",
          },
          actualDeparture: {
            utc: "2026-12-21T18:31:00.000Z",
            local: "2026-12-21T19:31:00",
            zone: "Europe/Berlin",
            offset: "+01:00",
            precision: "minute",
          },
          actualArrival: null,
        },
      })
    );
    renderPage();

    const departure = await screen.findByTestId("plan-actual-departure");
    expect(departure).toHaveTextContent("19:06");
    expect(departure).toHaveTextContent("19:31");
    expect(departure).toHaveTextContent("flights:planActual.later");
    expect(screen.getByTestId("plan-actual-arrival-actual")).toHaveTextContent(
      "flights:planActual.unknown"
    );
  });

  it("puts the day-of-travel card at the top of an upcoming flight (forgejo#220)", async () => {
    getByIdMock.mockResolvedValue(makeFlight({ bookingReference: "XY7Z9Q" }));
    renderPage();

    const card = await screen.findByRole("region", { name: "flights:dayCard.title" });
    expect(card).toHaveTextContent("XY7Z9Q");
    expect(card).toHaveTextContent("flights:dayCard.missing");
    await waitFor(() =>
      expect(listForEntryMock).toHaveBeenCalledWith({ type: "flight", id: "f1" })
    );
  });

  it("shows the booking's other flights as one journey, each linked (forgejo#218)", async () => {
    const own = makeFlight({ bookingId: "b1" });
    const onward = makeFlight({
      id: "f2",
      flightNumber: "LH400",
      depIata: "CPH",
      arrIata: "JFK",
      bookingId: "b1",
      departureTime: "2026-12-21T21:00:00.000Z",
    });
    getByIdMock.mockResolvedValue(own);
    getBookingMock.mockResolvedValue({
      booking: { id: "b1", pnr: "ABC123", price: null, currency: null, otherEntries: 0 },
      segments: [own, onward],
    });
    renderPage();

    const list = await screen.findByTestId("booking-itinerary");
    expect(getBookingMock).toHaveBeenCalledWith("f1");
    expect(list).toHaveTextContent("MUC → CPH");
    expect(screen.getByRole("link", { name: /CPH → JFK/ })).toHaveAttribute("href", "/flights/f2");
  });

  it("asks for no booking when the flight is linked to none", async () => {
    getByIdMock.mockResolvedValue(makeFlight());
    renderPage();
    await waitFor(() => expect(screen.getByText(/LH2462/)).toBeInTheDocument());
    expect(getBookingMock).not.toHaveBeenCalled();
  });

  it("gives a baggage allowance typed as a bare number its unit (forgejo#186)", async () => {
    // "Freigepäck 23" — the tester typed only the number, and the page
    // repeated it without saying 23 of what.
    getByIdMock.mockResolvedValue(
      makeFlight({ bookingReference: "XY7Z9Q", baggageAllowance: "23" })
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("XY7Z9Q")).toBeInTheDocument());
    expect(screen.getByText("23 kg")).toBeInTheDocument();
    expect(screen.queryByText("23")).not.toBeInTheDocument();
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
  /**
   * Finding 3 of the write-path audit (2026-09-19): deleting a flight takes
   * its documents with it — `onDelete: Cascade`, measured against the live
   * database by `backend/src/__tests__/integrity/cascades.integrity.test.ts` —
   * and the dialog said nothing about them.
   */
  it("names the documents that cascade with the flight", async () => {
    getByIdMock.mockResolvedValue(makeFlight());
    listForEntryMock.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/LH2462/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "common:buttons.delete" }));

    const dialog = await screen.findByTestId("confirm-modal");
    await waitFor(() => expect(dialog.textContent).toContain("documents:deleteCascadeNote"));
    expect(listForEntryMock).toHaveBeenCalledWith({ type: "flight", id: "f1" });
  });

  it("counts nothing until the dialog is opening", async () => {
    // A past flight with no day-of-travel values, so the day card (forgejo#220),
    // which lists the flight's documents for its boarding pass, is not drawn.
    getByIdMock.mockResolvedValue(makeFlight({ status: "flown" }));
    renderPage();

    await waitFor(() => expect(screen.getByText(/LH2462/)).toBeInTheDocument());
    // A reader who never reaches for the delete button pays for no request.
    expect(listForEntryMock).not.toHaveBeenCalled();
  });

  it("opens at once and adds the line when the count arrives", async () => {
    let settle: (rows: { id: string }[]) => void = () => {};
    listForEntryMock.mockReturnValue(
      new Promise<{ id: string }[]>((resolve) => {
        settle = resolve;
      })
    );
    getByIdMock.mockResolvedValue(makeFlight());
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/LH2462/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "common:buttons.delete" }));

    // The question is on screen before the count is: a warning is worth
    // adding to a dialog, never worth delaying it.
    const dialog = await screen.findByTestId("confirm-modal");
    expect(dialog.textContent).toContain("flights:table.deleteConfirm.message");
    expect(dialog.textContent).not.toContain("documents:deleteCascadeNote");

    settle([{ id: "d1" }]);
    await waitFor(() => expect(dialog.textContent).toContain("documents:deleteCascadeNote"));
  });

  it("keeps the base sentence when the count cannot be had", async () => {
    getByIdMock.mockResolvedValue(makeFlight());
    listForEntryMock.mockRejectedValue(new Error("Network Error"));
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/LH2462/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "common:buttons.delete" }));

    const dialog = await screen.findByTestId("confirm-modal");
    await waitFor(() => expect(listForEntryMock).toHaveBeenCalled());
    expect(dialog.textContent).toContain("flights:table.deleteConfirm.message");
    expect(dialog.textContent).not.toContain("documents:deleteCascadeNote");
  });
});
