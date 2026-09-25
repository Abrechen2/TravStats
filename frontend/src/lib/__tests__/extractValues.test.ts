import { describe, it, expect } from "vitest";

import {
  initialSelection,
  offeredFields,
  pickValues,
  type ExtractedValues,
} from "../extractValues";
import { departureDay } from "../extractTargets";

const FOUND: ExtractedValues = {
  price: 412.8,
  currency: "EUR",
  bookingReference: "ABC123",
  seatNumber: "12A",
  seatClass: "business",
};

/**
 * The preview's one rule: a found value is pre-ticked only where the entry's
 * field is empty; a filled field is offered unticked; the same value is not
 * offered at all; and a field the entry does not have never appears.
 */
describe("extract values — what the preview offers and ticks", () => {
  it("offers only fields the entry has and the parser found", () => {
    const offered = offeredFields(
      { ...FOUND, seatNumber: null },
      { price: undefined, currency: "EUR", bookingReference: "" }
    );
    // seatNumber: not found. seatClass: not a field of this entry. currency: same.
    expect(offered).toEqual(["price", "bookingReference"]);
  });

  it("reads a typed amount and a stored one alike", () => {
    expect(offeredFields(FOUND, { price: "412.80" })).toEqual([]);
    expect(offeredFields(FOUND, { price: 412.8 })).toEqual([]);
    expect(offeredFields(FOUND, { price: "400" })).toEqual(["price"]);
  });

  it("ticks empty fields and leaves filled ones for the user to choose", () => {
    const current = { price: 0, currency: "USD", bookingReference: "XYZ999", seatNumber: "" };
    const offered = offeredFields(FOUND, current);
    expect(offered).toEqual(["price", "currency", "bookingReference", "seatNumber"]);
    // The currency beside no price is the form's default, not a choice.
    expect(initialSelection(offered, current)).toEqual(["price", "currency", "seatNumber"]);
  });

  it("keeps a chosen currency beside a recorded price unticked", () => {
    const current = { price: 99, currency: "USD" };
    expect(initialSelection(offeredFields(FOUND, current), current)).toEqual([]);
  });

  it("hands on only the ticked values", () => {
    expect(pickValues(FOUND, ["price", "seatClass"])).toEqual({
      price: 412.8,
      seatClass: "business",
    });
  });

  it("dates a flight in its departure zone", () => {
    expect(
      departureDay({ departureTime: "2026-05-01T23:30:00Z", depTimezone: "Europe/Rome" })
    ).toBe("2026-05-02");
    expect(departureDay({ departureTime: undefined, depTimezone: null } as never)).toBeUndefined();
  });
});
