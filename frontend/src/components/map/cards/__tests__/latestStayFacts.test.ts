import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { latestStayFacts } from "../cardStats";
import type { LodgingCardStay } from "../pinnedTypes";

/**
 * The card names ONE visit, so it has to pick one — the branch's only new
 * derivation, and the one place where "which stay" can disagree with the
 * numbers printed beside it.
 *
 * It picked the maximum ISO date, so a booking for next month beat every
 * night already slept. The hero counts only stays whose check-out has passed
 * (`shared/lodgingCounting.ts`, owner rule), so the card read "2 Aufenthalte"
 * above "Aufenthalt: next month" — a stay the count deliberately excludes,
 * presented as the stay the card is about.
 */

function stay(over: Partial<LodgingCardStay>): LodgingCardStay {
  return {
    checkIn: null,
    checkOut: null,
    datePrecision: "DAY",
    nights: null,
    totalPrice: null,
    currency: "EUR",
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("latestStayFacts — which stay the card is about", () => {
  it("names the most recent stay already slept, not the booking ahead of it", () => {
    const facts = latestStayFacts(
      [
        stay({ checkIn: "2026-05-01", checkOut: "2026-05-04", totalPrice: 300 }),
        stay({ checkIn: "2026-08-10", checkOut: "2026-08-12", totalPrice: 200 }),
        stay({ checkIn: "2026-10-01", checkOut: "2026-10-05", totalPrice: 900 }),
      ],
      "de"
    );
    expect(facts.dateRange).toContain("2026");
    expect(facts.dateRange).toMatch(/08|10\.08/);
    expect(facts.upcoming).toBe(false);
    expect(facts.price).toContain("200");
  });

  it("falls back to the nearest future booking when nothing has been slept yet, and says so", () => {
    const facts = latestStayFacts(
      [
        stay({ checkIn: "2026-12-01", checkOut: "2026-12-04" }),
        stay({ checkIn: "2026-10-01", checkOut: "2026-10-05" }),
      ],
      "de"
    );
    expect(facts.upcoming).toBe(true);
    // The NEAREST of the two, not simply the maximum date.
    expect(facts.dateRange).toMatch(/10/);
  });

  // The boundary is `shared/statusDerivation.ts`'s, asked rather than
  // re-decided here: a stay is past once `now >= checkOut`, and a date-only
  // check-out is midnight, so one dated today is already over by noon.
  it("follows the shared boundary: a stay still running is ahead, one ending today is past", () => {
    expect(
      latestStayFacts([stay({ checkIn: "2026-09-18", checkOut: "2026-09-22" })], "de").upcoming
    ).toBe(true);
    expect(
      latestStayFacts([stay({ checkIn: "2026-09-18", checkOut: "2026-09-20" })], "de").upcoming
    ).toBe(false);
  });

  it("names no stay at all when there are none", () => {
    expect(latestStayFacts([], "de")).toEqual({ dateRange: null, price: null, upcoming: false });
    expect(latestStayFacts(undefined, "de").dateRange).toBeNull();
  });

  it("abstains from a date range at month or year precision rather than inventing a day", () => {
    const facts = latestStayFacts(
      [stay({ checkIn: "2026-05-01", checkOut: "2026-05-31", datePrecision: "MONTH" })],
      "de"
    );
    expect(facts.dateRange).toBeNull();
  });

  it("withholds the price when it cannot name the stay it belongs to", () => {
    // A price under a lifetime nights figure, with nothing saying which visit
    // it was, is a number the reader cannot place.
    const facts = latestStayFacts(
      [stay({ checkIn: null, checkOut: null, datePrecision: "NONE", totalPrice: 420 })],
      "de"
    );
    expect(facts.dateRange).toBeNull();
    expect(facts.price).toBeNull();
  });
});
