import { describe, it, expect } from "vitest";
import { comparisonWindow, windowEndInYear, windowEndKeyInYear } from "../comparisonWindow";

/** Local calendar parts, not an ISO instant — the window counts days. */
const SEPT_18_2026 = new Date(2026, 8, 18);

describe("comparisonWindow", () => {
  it("cuts a still-running year at today, on both sides", () => {
    const window = comparisonWindow(2026, SEPT_18_2026);
    expect(window.kind).toBe("samePeriod");
    expect(windowEndKeyInYear(window, 2026)).toBe("2026-09-18");
    expect(windowEndKeyInYear(window, 2025)).toBe("2025-09-18");
    expect(window.previousEnd.getFullYear()).toBe(2025);
  });

  it("leaves a completed year comparing whole years", () => {
    const window = comparisonWindow(2025, SEPT_18_2026);
    expect(window.kind).toBe("fullYear");
    expect(windowEndKeyInYear(window, 2025)).toBe("2025-12-31");
    expect(windowEndKeyInYear(window, 2024)).toBe("2024-12-31");
  });

  it("asks whether the year is over, not whether it is the clock year", () => {
    // A reader looking at 2024 in 2026 sees a full-year comparison: 2024 is
    // over, so nothing about it is still accruing.
    expect(comparisonWindow(2024, SEPT_18_2026).kind).toBe("fullYear");
    expect(comparisonWindow(2026, SEPT_18_2026).kind).toBe("samePeriod");
  });

  it("clamps 29 February to the 28th in a year that has no 29th", () => {
    // `new Date(2023, 1, 29)` rolls forward to 1 March, which would let a
    // 1 March event into a window that is supposed to end in February.
    const window = comparisonWindow(2024, new Date(2024, 1, 29));
    expect(windowEndKeyInYear(window, 2024)).toBe("2024-02-29");
    expect(windowEndKeyInYear(window, 2023)).toBe("2023-02-28");
    expect(windowEndInYear(window, 2023).getMonth()).toBe(1);
  });

  it("holds the window against an arbitrary compare year, not only the year before", () => {
    // The compare year is the reader's pick and survives a revisit (#188).
    const window = comparisonWindow(2026, SEPT_18_2026);
    expect(windowEndKeyInYear(window, 2019)).toBe("2019-09-18");
  });
});
