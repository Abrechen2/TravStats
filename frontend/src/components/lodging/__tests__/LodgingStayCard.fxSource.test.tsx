import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LodgingStayCard } from "../LodgingStayCard";
import type { LodgingStay } from "../../../types/lodging";

/**
 * These render the CARD, not the formatter.
 *
 * `formatStayPriceDisplay` was always source-aware and its own tests were
 * green — while the screen labelled a CDN rate and a hand-typed rate alike as
 * an ECB reference rate, because this component built the snapshot object
 * field by field and left `fxSource` out. Found by looking at the browser.
 * A test that calls the formatter directly cannot catch a caller that forgets
 * to pass it; only rendering can.
 *
 * `t` returns the key in tests, so "lodging:fx.source" IS the ECB label.
 */
const baseStay: LodgingStay = {
  id: "stay-fx",
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
  currency: "EGP",
  totalPrice: 11662,
  totalPriceBase: 227.72,
  fxRate: 0.019526938,
  fxRateDate: "2024-06-01T00:00:00.000Z",
  fxBaseCurrency: "EUR",
  fxSource: "cdn",
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

describe("LodgingStayCard names the rate's source", () => {
  it("calls a CDN rate a market rate, never an ECB one", () => {
    render(<LodgingStayCard stay={baseStay} />);
    const readout = screen.getByTestId("stay-fx-readout-stay-fx");
    // `\b` alone would not do: "lodging:fx.source" is a prefix of
    // "lodging:fx.sourceMarket", so the ECB label is matched by what FOLLOWS it.
    expect(readout.textContent).toMatch(/lodging:fx\.sourceMarket\s/);
    expect(readout.textContent).not.toMatch(/lodging:fx\.source\s/);
  });

  it("marks a hand-typed rate as the user's own, never as an ECB one", () => {
    render(
      <LodgingStayCard
        stay={{ ...baseStay, currency: "AED", fxRate: 0.2489, fxSource: "manual" }}
      />
    );
    const readout = screen.getByTestId("stay-fx-readout-stay-fx");
    expect(readout.textContent).toMatch(/lodging:fx\.markerManual\s/);
    expect(readout.textContent).not.toMatch(/lodging:fx\.source/);
    expect(screen.getByTestId("stay-fx-marker-stay-fx").textContent).toBe(
      "lodging:fx.markerManual"
    );
  });

  it("keeps saying ECB for a rate the ECB actually published", () => {
    render(<LodgingStayCard stay={{ ...baseStay, currency: "NOK", fxSource: "ecb" }} />);
    expect(screen.getByTestId("stay-fx-readout-stay-fx").textContent).toMatch(
      /lodging:fx\.source\s/
    );
  });
});
