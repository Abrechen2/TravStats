import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const updateBooking = vi
  .fn()
  .mockResolvedValue({ id: "b1", pnr: "ABC", price: 500, currency: "EUR" });
vi.mock("../../../lib/api", () => ({
  tripsApi: { updateBooking: (...args: unknown[]) => updateBooking(...args) },
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => ["NOK"] };
});

// The suite-wide store mock pins EUR, which is exactly the value this file
// must tell apart from a base currency.
let baseCurrency = "CHF";
vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: (sel: (s: object) => unknown) =>
    sel({ baseCurrency, display: { language: "en" } }),
}));

import BookingEditModal, { pnrSuggestions } from "../BookingEditModal";

/** The currency picker — the deadline zone field (forgejo#285) is a combobox too. */
const currencySelect = (): HTMLElement =>
  screen.getAllByRole("combobox").find((el) => el.tagName === "SELECT")!;

const booking = { id: "b1", userId: "u1", tripId: "t1", pnr: "ABC", price: 250, currency: "EUR" };

describe("BookingEditModal", () => {
  beforeEach(() => {
    updateBooking.mockClear();
    addToast.mockClear();
  });

  it("prefills, submits the changed price via PATCH and calls onSaved", async () => {
    const onSaved = vi.fn();
    render(<BookingEditModal booking={booking} onClose={() => {}} onSaved={onSaved} />);
    const priceInput = screen.getByLabelText(/price|Gesamtpreis|trips:bookingEdit\.price/i);
    fireEvent.change(priceInput, { target: { value: "500" } });
    fireEvent.click(
      screen.getByRole("button", { name: /save|Speichern|trips:bookingEdit\.save/i })
    );
    await waitFor(() =>
      expect(updateBooking).toHaveBeenCalledWith("b1", expect.objectContaining({ price: 500 }))
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("sends a day-only cancellation as the day, and holds a time without a zone (forgejo#285)", async () => {
    render(<BookingEditModal booking={booking} onClose={() => {}} onSaved={() => {}} />);
    const save = screen.getByRole("button", { name: /save|Speichern|trips:bookingEdit\.save/i });
    fireEvent.change(screen.getByLabelText(/deadlines.form.freeCancellationDate/), {
      target: { value: "2027-04-30" },
    });
    fireEvent.change(screen.getByLabelText(/deadlines.form.freeCancellationTime/), {
      target: { value: "18:00" },
    });
    // A booking names no place: a time without its zone cannot be placed.
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/deadlines.form.freeCancellationTime/), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText(/deadlines.form.paymentDueOn/), {
      target: { value: "2027-04-01" },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(updateBooking).toHaveBeenCalledWith(
        "b1",
        expect.objectContaining({ freeCancellationUntil: "2027-04-30", paymentDueOn: "2027-04-01" })
      )
    );
  });

  it("a booking without a currency starts in the base currency, not EUR", async () => {
    baseCurrency = "CHF";
    render(
      <BookingEditModal
        booking={{ ...booking, currency: null }}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(currencySelect()).toHaveValue("CHF");
    fireEvent.click(
      screen.getByRole("button", { name: /save|Speichern|trips:bookingEdit\.save/i })
    );
    await waitFor(() =>
      expect(updateBooking).toHaveBeenCalledWith("b1", expect.objectContaining({ currency: "CHF" }))
    );
  });

  it("a stored currency is kept, and the picker offers the user's own currencies", () => {
    baseCurrency = "CHF";
    render(<BookingEditModal booking={booking} onClose={() => {}} onSaved={() => {}} />);
    expect(currencySelect()).toHaveValue("EUR");
    const frequent = screen.getByRole("group", { name: /currencySelect.frequent/i });
    expect(within(frequent).getByText(/NOK/)).toBeInTheDocument();
  });

  it("cancel closes without a PATCH", () => {
    const onClose = vi.fn();
    render(<BookingEditModal booking={booking} onClose={onClose} onSaved={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: /cancel|Abbrechen|trips:bookingEdit\.cancel/i })
    );
    expect(onClose).toHaveBeenCalled();
    expect(updateBooking).not.toHaveBeenCalled();
  });

  it("offers the PNRs of the trip's flights, this booking's own first, once each", () => {
    expect(
      pnrSuggestions("b1", [
        { bookingId: "b2", bookingReference: "OTHER1" },
        { bookingId: "b1", bookingReference: " xyz123 " },
        { bookingId: "b1", bookingReference: "XYZ123" },
        { bookingId: null, bookingReference: "" },
        { bookingId: null, bookingReference: null },
      ])
    ).toEqual(["xyz123", "OTHER1"]);
  });

  it("fills the PNR from a chip and submits it", async () => {
    render(
      <BookingEditModal
        booking={{ ...booking, pnr: null }}
        flights={[{ bookingId: "b1", bookingReference: "XYZ123" }]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    fireEvent.click(screen.getByText("XYZ123"));
    fireEvent.click(
      screen.getByRole("button", { name: /save|Speichern|trips:bookingEdit\.save/i })
    );
    await waitFor(() =>
      expect(updateBooking).toHaveBeenCalledWith("b1", expect.objectContaining({ pnr: "XYZ123" }))
    );
  });
});
