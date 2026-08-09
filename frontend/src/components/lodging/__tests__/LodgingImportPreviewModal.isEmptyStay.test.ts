import { describe, expect, it } from "vitest";
import { isEmptyStay } from "../LodgingImportPreviewModal";

const blank = {
  checkIn: "",
  checkOut: "",
  totalPrice: null,
  roomCategory: null,
  board: null,
  currency: null,
  ratingRoom: null,
  ratingBreakfast: null,
  ratingService: null,
  ratingOverall: null,
  bookingReference: null,
  externalRef: null,
  notes: null,
};

describe("isEmptyStay", () => {
  it("treats a wholly blank stay as empty", () => {
    expect(isEmptyStay(blank)).toBe(true);
  });

  it("treats a stay carrying any single rating as non-empty", () => {
    // All three components must count. Listing only room and breakfast made a
    // service-rating-only row silently vanish while the other two surfaced as
    // an incomplete row — the same input treated two different ways.
    expect(isEmptyStay({ ...blank, ratingRoom: 4 })).toBe(false);
    expect(isEmptyStay({ ...blank, ratingBreakfast: 4 })).toBe(false);
    expect(isEmptyStay({ ...blank, ratingService: 4 })).toBe(false);
  });
});
