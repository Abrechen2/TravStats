import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const createBooking = vi.fn();
const updateBooking = vi.fn();
const setBookingEntries = vi.fn();
vi.mock("../../../lib/api", () => ({
  tripsApi: {
    createBooking: (...a: unknown[]) => createBooking(...a),
    updateBooking: (...a: unknown[]) => updateBooking(...a),
    setBookingEntries: (...a: unknown[]) => setBookingEntries(...a),
  },
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: (sel: (s: object) => unknown) =>
    sel({ baseCurrency: "EUR", display: { language: "de" } }),
}));

import BookingEditModal from "../BookingEditModal";

const entries = {
  flightIds: [{ id: "f1", label: "FRA → ICN", bookingId: null }],
  stayIds: [
    { id: "s1", label: "Hotel Seoul", bookingId: "b1" },
    { id: "s2", label: "Hotel Busan", bookingId: null },
  ],
  cruiseIds: [],
};

const save = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /trips:bookingEdit\.save|Speichern/i }));
};

/** #356: a package booking is created and edited by hand on the trip page. */
describe("BookingEditModal — package bookings (#356)", () => {
  beforeEach(() => {
    createBooking.mockReset();
    updateBooking.mockReset();
    setBookingEntries.mockReset();
    addToast.mockReset();
  });

  it("creates a booking with operator, travellers, booking day and the ticked entries", async () => {
    createBooking.mockResolvedValue({ id: "new" });
    const onSaved = vi.fn();
    render(
      <BookingEditModal
        booking={null}
        tripId="t1"
        entries={entries}
        onClose={() => {}}
        onSaved={onSaved}
      />
    );
    fireEvent.change(screen.getByLabelText(/bookingEdit\.operator|Veranstalter/i), {
      target: { value: "Tourlane" },
    });
    fireEvent.change(screen.getByLabelText(/bookingEdit\.travellers|Anzahl Personen/i), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText(/bookingEdit\.bookedOn|Gebucht am/i), {
      target: { value: "2025-09-12" },
    });
    fireEvent.click(screen.getByLabelText("FRA → ICN"));
    fireEvent.click(screen.getByLabelText("Hotel Busan"));
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: "t1",
        operator: "Tourlane",
        travellers: 2,
        bookedOn: "2025-09-12",
        flightIds: ["f1"],
        stayIds: ["s2"],
        cruiseIds: [],
      })
    );
  });

  it("refuses a traveller count that is not a whole number from 1 to 50", () => {
    render(<BookingEditModal booking={null} tripId="t1" onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(/bookingEdit\.travellers|Anzahl Personen/i), {
      target: { value: "0" },
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    save();
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("files changed entries on an edit and says so when that second step fails", async () => {
    updateBooking.mockResolvedValue({ id: "b1" });
    setBookingEntries.mockRejectedValue(new Error("boom"));
    const booking = { id: "b1", userId: "u", tripId: "t1", pnr: "X", price: 1, currency: "EUR" };
    const onSaved = vi.fn();
    render(
      <BookingEditModal booking={booking} entries={entries} onClose={() => {}} onSaved={onSaved} />
    );
    expect(screen.getByLabelText("Hotel Seoul")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Hotel Busan"));
    save();
    await waitFor(() => expect(setBookingEntries).toHaveBeenCalled());
    expect(setBookingEntries).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({ stayIds: ["s1", "s2"] })
    );
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        "error",
        expect.stringMatching(/entriesFailed|zugeordnet/)
      )
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("does not touch the entries when their ticks did not change", async () => {
    updateBooking.mockResolvedValue({ id: "b1" });
    const booking = { id: "b1", userId: "u", tripId: "t1", pnr: "X", price: 1, currency: "EUR" };
    const onSaved = vi.fn();
    render(
      <BookingEditModal booking={booking} entries={entries} onClose={() => {}} onSaved={onSaved} />
    );
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(setBookingEntries).not.toHaveBeenCalled();
  });
});
