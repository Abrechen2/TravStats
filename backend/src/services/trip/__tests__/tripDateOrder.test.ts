import { assertMergedTripDates, mergedTripDates } from "../tripDateOrder";

const AUG_01 = new Date("2025-08-01T00:00:00.000Z");
const AUG_10 = new Date("2025-08-10T00:00:00.000Z");
const AUG_12 = new Date("2025-08-12T00:00:00.000Z");

describe("assertMergedTripDates (SRV-TRIP-DATE-001)", () => {
  it("refuses the audit's trip: 10.08. to 01.08., sent whole", () => {
    expect(() =>
      assertMergedTripDates(
        { startDate: AUG_10, endDate: AUG_01 },
        { startDate: null, endDate: null }
      )
    ).toThrow(/endDate must not precede startDate/);
  });

  it("refuses a patch that moves ONLY the end date behind the stored start", () => {
    expect(() =>
      assertMergedTripDates({ endDate: AUG_01 }, { startDate: AUG_10, endDate: AUG_12 })
    ).toThrow(/endDate must not precede startDate/);
  });

  it("refuses a patch that moves ONLY the start date past the stored end", () => {
    expect(() =>
      assertMergedTripDates({ startDate: AUG_12 }, { startDate: AUG_01, endDate: AUG_10 })
    ).toThrow(/endDate must not precede startDate/);
  });

  it("allows a one-day trip — same day is a span, not an inversion", () => {
    expect(() =>
      assertMergedTripDates(
        { startDate: AUG_10, endDate: AUG_10 },
        { startDate: null, endDate: null }
      )
    ).not.toThrow();
  });

  it("allows a patch that repairs an already-inverted row", () => {
    expect(() =>
      assertMergedTripDates({ endDate: AUG_12 }, { startDate: AUG_10, endDate: AUG_01 })
    ).not.toThrow();
  });

  it("allows a patch that clears one end — an open span cannot be out of order", () => {
    expect(() =>
      assertMergedTripDates({ startDate: null }, { startDate: AUG_10, endDate: AUG_01 })
    ).not.toThrow();
  });

  it("leaves a field the patch did not mention alone", () => {
    expect(mergedTripDates({ endDate: AUG_12 }, { startDate: AUG_10, endDate: AUG_01 })).toEqual({
      startDate: AUG_10,
      endDate: AUG_12,
    });
    // An explicit null is a clear, not an absence.
    expect(mergedTripDates({ endDate: null }, { startDate: AUG_10, endDate: AUG_01 })).toEqual({
      startDate: AUG_10,
      endDate: null,
    });
  });
});
