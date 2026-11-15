import { describe, expect, it } from "vitest";
import { stayDraftFields } from "../stayEditorDraft";
import { buildStayInput, type StayInputSource } from "../stayEditorInput";

/**
 * The request body was assembled inline in the editor's submit
 * (forgejo#386 REF-15); it is a pure function now and its clearing rules are
 * pinned here.
 */
const source = (over: Partial<StayInputSource> = {}): StayInputSource => {
  const d = stayDraftFields(null, "EUR");
  return {
    stay: null,
    datePrecision: "DAY",
    checkIn: "2026-10-01",
    checkOut: "2026-10-04",
    checkInTime: "15:00",
    checkOutTime: "11:00",
    parsedNights: null,
    effectiveStatus: "scheduled",
    roomNumber: " 12 ",
    roomCategory: "",
    board: d.board,
    derivedPricePerNight: 100,
    currency: "EUR",
    parsedTotalPrice: 300,
    parsedManualFxRate: null,
    isAwardStay: false,
    ratings: {},
    derivedRatingOverall: null,
    roomAmenities: ["wifi"],
    bookingReference: " ABC ",
    membershipId: "m1",
    membershipOptOut: false,
    receiptUrl: null,
    tripId: "",
    companionsInput: "Anna, Ben,, ",
    notes: "  ",
    deadlines: d.deadlines,
    initialDeadlines: d.deadlines,
    ...over,
  };
};

describe("buildStayInput", () => {
  it("sends bare days, trims text to explicit nulls and splits companions", () => {
    const input = buildStayInput(source());
    expect(input).toMatchObject({
      checkIn: "2026-10-01",
      checkOut: "2026-10-04",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      roomNumber: "12",
      roomCategory: null,
      bookingReference: "ABC",
      tripId: null,
      notes: null,
      companions: ["Anna", "Ben"],
      totalPrice: 300,
      pricePerNight: 100,
      membershipId: "m1",
    });
  });

  it("clears both dates and times at NONE precision instead of sending a hidden date", () => {
    const input = buildStayInput(source({ datePrecision: "NONE" }));
    expect(input).toMatchObject({
      checkIn: null,
      checkOut: null,
      checkInTime: null,
      checkOutTime: null,
    });
  });

  it("drops the check-out and the times at MONTH precision", () => {
    const input = buildStayInput(source({ datePrecision: "MONTH" }));
    expect(input.checkOut).toBeNull();
    expect(input.checkInTime).toBeNull();
    expect(input.checkOutTime).toBeNull();
    expect(input.checkIn).toBe("2026-10-01");
  });

  it("never writes the resolved card back: an opt-out sends no membership id", () => {
    const input = buildStayInput(source({ membershipOptOut: true }));
    expect(input.membershipId).toBeNull();
    expect(input.membershipOptOut).toBe(true);
  });

  it("sends isAward false explicitly so an edit can turn it back off", () => {
    expect(buildStayInput(source({ isAwardStay: false })).isAwardStay).toBe(false);
  });
});
