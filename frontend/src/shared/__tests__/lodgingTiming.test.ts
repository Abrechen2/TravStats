import { describe, it, expect } from "vitest";
import { resolveStayTiming, type TimedStay } from "../lodgingTiming";

/**
 * MIRROR of `backend/src/shared/__tests__/lodgingTiming.test.ts` — the same
 * truth table for the four precisions, asserted on the client copy. Change one
 * side alone and one of the two suites goes red, which is the point.
 */
const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

const stay = (o: Partial<TimedStay>): TimedStay => ({
  checkIn: d("2024-05-14"),
  checkOut: d("2024-05-16"),
  datePrecision: "DAY",
  nights: null,
  ...o,
});

describe("resolveStayTiming", () => {
  it("takes nights from the dates when both ends are real", () => {
    const t = resolveStayTiming(stay({}));
    expect(t.nights).toBe(2);
    expect(t.nightsKnown).toBe(true);
    expect(t.walkable).toBe(true);
    expect(t.canBucketByMonth).toBe(true);
  });

  it("lets the dates beat a stale explicit night count", () => {
    // The field would otherwise outlive an edited date and quietly disagree
    // with the two ends sitting right next to it.
    const t = resolveStayTiming(stay({ nights: 99 }));
    expect(t.nights).toBe(2);
  });

  it("uses the explicit count when there are no dates at all", () => {
    const t = resolveStayTiming(
      stay({ checkIn: null, checkOut: null, datePrecision: "NONE", nights: 3 }),
    );
    expect(t.precision).toBe("NONE");
    expect(t.nights).toBe(3);
    expect(t.nightsKnown).toBe(true);
    expect(t.walkable).toBe(false);
    expect(t.anchor).toBeNull();
    expect(t.canBucketByYear).toBe(false);
    expect(t.canBucketByMonth).toBe(false);
  });

  it("distinguishes 'nobody knows' from 'a same-day stay'", () => {
    // Both report 0 nights, and an average over the second is a different
    // claim from an average over the first.
    const unknown = resolveStayTiming(
      stay({ checkIn: null, checkOut: null, datePrecision: "NONE", nights: null }),
    );
    const sameDay = resolveStayTiming(stay({ checkOut: d("2024-05-14") }));
    expect(unknown.nights).toBe(0);
    expect(unknown.nightsKnown).toBe(false);
    expect(sameDay.nights).toBe(0);
    expect(sameDay.nightsKnown).toBe(true);
  });

  it("lets a month-precision stay reach the month bucket but not a day walk", () => {
    const t = resolveStayTiming(
      stay({ checkIn: d("2011-07-01"), checkOut: null, datePrecision: "MONTH", nights: 5 }),
    );
    expect(t.nights).toBe(5);
    expect(t.walkable).toBe(false);
    expect(t.canBucketByYear).toBe(true);
    expect(t.canBucketByMonth).toBe(true);
  });

  it("keeps a year-precision stay out of the month bucket", () => {
    // Stored as 1 January. Bucketing that by month would report a January
    // holiday the user never took.
    const t = resolveStayTiming(
      stay({ checkIn: d("2011-01-01"), checkOut: null, datePrecision: "YEAR", nights: 4 }),
    );
    expect(t.canBucketByYear).toBe(true);
    expect(t.canBucketByMonth).toBe(false);
  });

  it("never walks a one-ended stay, even at DAY precision", () => {
    // One date cannot say how long. The span is unknown, not zero.
    const t = resolveStayTiming(stay({ checkOut: null }));
    expect(t.walkable).toBe(false);
    expect(t.nightsKnown).toBe(false);
    expect(t.canBucketByMonth).toBe(true);
  });

  it("forces NONE when the dates are gone but the column still says DAY", () => {
    // A row edited to clear its dates without its precision being updated must
    // not go on claiming a precision it cannot back.
    const t = resolveStayTiming(
      stay({ checkIn: null, checkOut: null, datePrecision: "DAY", nights: 2 }),
    );
    expect(t.precision).toBe("NONE");
    expect(t.anchor).toBeNull();
  });

  it("falls back to DAY for an unrecognised precision on a dated stay", () => {
    const t = resolveStayTiming(stay({ datePrecision: "WHENEVER" }));
    expect(t.precision).toBe("DAY");
    expect(t.nights).toBe(2);
  });

  it("ignores a negative explicit night count", () => {
    const t = resolveStayTiming(
      stay({ checkIn: null, checkOut: null, datePrecision: "NONE", nights: -3 }),
    );
    expect(t.nights).toBe(0);
    expect(t.nightsKnown).toBe(false);
  });
});
