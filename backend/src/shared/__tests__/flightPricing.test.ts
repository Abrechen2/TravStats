import {
  hasRecordedBookingPrice,
  hasRecordedOwnCost,
  isAmountRecorded,
  recordedOwnAmount,
} from "../flightPricing";

describe("flightPricing — a recorded 0 is a price (SRV-STATS-ZERO-PRICE-001)", () => {
  describe("isAmountRecorded", () => {
    it("says a zero amount was recorded, unlike a truthiness test", () => {
      expect(isAmountRecorded(0)).toBe(true);
    });

    it("says an absent amount was not recorded", () => {
      expect(isAmountRecorded(null)).toBe(false);
      expect(isAmountRecorded(undefined)).toBe(false);
    });

    it("rejects NaN, which a form field can produce and a sum cannot survive", () => {
      expect(isAmountRecorded(Number.NaN)).toBe(false);
      expect(isAmountRecorded(Number.POSITIVE_INFINITY)).toBe(false);
    });
  });

  describe("hasRecordedOwnCost", () => {
    it("counts a flight explicitly saved at 0 EUR as priced", () => {
      expect(hasRecordedOwnCost({ price: 0, taxes: null, fees: null })).toBe(true);
    });

    it("counts a flight with taxes only, no base price", () => {
      expect(hasRecordedOwnCost({ price: null, taxes: 0, fees: null })).toBe(true);
    });

    it("abstains for a flight nobody put a number on", () => {
      expect(hasRecordedOwnCost({ price: null, taxes: null, fees: null })).toBe(false);
      expect(hasRecordedOwnCost({})).toBe(false);
    });
  });

  describe("hasRecordedBookingPrice", () => {
    it("counts a booking explicitly saved at 0 as priced", () => {
      expect(hasRecordedBookingPrice({ price: 0 })).toBe(true);
    });

    it("abstains for a booking with no amount and for no booking at all", () => {
      expect(hasRecordedBookingPrice({ price: null })).toBe(false);
      expect(hasRecordedBookingPrice(null)).toBe(false);
      expect(hasRecordedBookingPrice(undefined)).toBe(false);
    });
  });

  describe("recordedOwnAmount", () => {
    it("returns 0 for a free flight and null for an unpriced one", () => {
      expect(recordedOwnAmount({ price: 0 })).toBe(0);
      expect(recordedOwnAmount({})).toBeNull();
    });

    it("adds taxes and fees onto the price, treating absent parts as 0", () => {
      expect(recordedOwnAmount({ price: 100, taxes: 20, fees: 10 })).toBe(130);
      expect(recordedOwnAmount({ price: 100 })).toBe(100);
    });
  });
});
