import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LodgingStayCard } from "../LodgingStayCard";
import type { LodgingStay } from "../../../types/lodging";

/**
 * The card offers the deletion; it never performs it.
 *
 * The backend route and the API client for deleting a stay both existed and
 * had no caller at all — the card offered `onEdit` and nothing else, so a
 * stay entered by mistake could be corrected but never removed (owner,
 * 2026-09-19). What this file pins is that the button appears only where a
 * caller is ready to answer for it, and that the click hands over the stay
 * rather than deleting anything here.
 *
 * `t` returns the key in tests, so "common:buttons.delete" IS the label.
 */
const baseStay: LodgingStay = {
  id: "stay-7",
  lodgingId: "lodging-1",
  userId: "user-1",
  tripId: null,
  bookingId: null,
  checkInTime: null,
  checkOutTime: null,
  checkIn: "2024-06-01T00:00:00.000Z",
  checkOut: "2024-06-05T00:00:00.000Z",
  datePrecision: "DAY" as const,
  nights: null,
  status: "completed",
  roomNumber: null,
  roomCategory: null,
  board: "none",
  pricePerNight: null,
  currency: "EUR",
  totalPrice: null,
  totalPriceBase: null,
  fxRate: null,
  fxRateDate: null,
  fxBaseCurrency: null,
  fxSource: null,
  isAwardStay: false,
  ratingRoom: null,
  ratingBreakfast: null,
  ratingService: null,
  ratingOverall: null,
  roomAmenities: [],
  bookingReference: null,
  membershipId: null,
  membershipOptOut: false,
  receiptUrl: null,
  guests: null,
  companions: [],
  notes: null,
  parserTemplate: null,
  parserConfidence: null,
  dataSource: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("LodgingStayCard — deleting a stay", () => {
  it("offers no delete button when no caller can answer for it", () => {
    render(<LodgingStayCard stay={baseStay} onEdit={vi.fn()} />);

    expect(screen.queryByTestId("stay-delete-stay-7")).not.toBeInTheDocument();
    expect(screen.queryByText("common:buttons.delete")).not.toBeInTheDocument();
  });

  it("offers the delete button when onDelete is given, and hands it the stay", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<LodgingStayCard stay={baseStay} onEdit={vi.fn()} onDelete={onDelete} />);

    const button = screen.getByTestId("stay-delete-stay-7");
    expect(button).toHaveTextContent("common:buttons.delete");

    await user.click(button);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(baseStay);
  });

  /**
   * A row is not the place for a red primary.
   *
   * Repeated down a list of stays it reads as what the row is FOR, and the
   * consequence it warns about is not stated anywhere near it. The red belongs
   * to the confirmation, which does state it.
   */
  it("keeps the row action quiet — no danger background, no primary weight", () => {
    render(<LodgingStayCard stay={baseStay} onEdit={vi.fn()} onDelete={vi.fn()} />);

    const className = screen.getByTestId("stay-delete-stay-7").className;
    expect(className).not.toMatch(/bg-\[var\(--danger\)\]/);
    expect(className).not.toMatch(/btn-primary/);
  });
});
