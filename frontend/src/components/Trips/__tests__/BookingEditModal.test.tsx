import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const updateBooking = vi.fn().mockResolvedValue({ id: "b1", pnr: "ABC", price: 500, currency: "EUR" });
vi.mock("../../../lib/api", () => ({
  tripsApi: { updateBooking: (...args: unknown[]) => updateBooking(...args) },
}));
const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

import BookingEditModal from "../BookingEditModal";

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
    fireEvent.click(screen.getByRole("button", { name: /save|Speichern|trips:bookingEdit\.save/i }));
    await waitFor(() => expect(updateBooking).toHaveBeenCalledWith("b1", expect.objectContaining({ price: 500 })));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("cancel closes without a PATCH", () => {
    const onClose = vi.fn();
    render(<BookingEditModal booking={booking} onClose={onClose} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel|Abbrechen|trips:bookingEdit\.cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(updateBooking).not.toHaveBeenCalled();
  });
});
