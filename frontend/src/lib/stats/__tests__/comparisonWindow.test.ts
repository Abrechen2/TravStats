import { afterEach, describe, it, expect, vi } from "vitest";
import { setClockForTests } from "../../../shared/time";
import { useProfileZoneStore } from "../../../store/profileZoneStore";
import { useSettingsStore } from "../../../store/settingsStore";

vi.unmock("../../../store/settingsStore");
import { comparisonWindow, windowEndInYear, windowEndKeyInYear } from "../comparisonWindow";

/** A calendar day, as the profile zone names it — the window counts days. */
const SEPT_18_2026 = "2026-09-18";

describe("comparisonWindow", () => {
  it("cuts a still-running year at today, on both sides", () => {
    const window = comparisonWindow(2026, 2025, SEPT_18_2026);
    expect(window.kind).toBe("samePeriod");
    expect(windowEndKeyInYear(window, 2026)).toBe("2026-09-18");
    expect(windowEndKeyInYear(window, 2025)).toBe("2025-09-18");
    expect(window.previousEnd.getUTCFullYear()).toBe(2025);
  });

  it("leaves a completed year comparing whole years", () => {
    const window = comparisonWindow(2025, 2024, SEPT_18_2026);
    expect(window.kind).toBe("fullYear");
    expect(windowEndKeyInYear(window, 2025)).toBe("2025-12-31");
    expect(windowEndKeyInYear(window, 2024)).toBe("2024-12-31");
  });

  it("asks whether the year is over, not whether it is the clock year", () => {
    // A reader looking at 2024 in 2026 sees a full-year comparison: 2024 is
    // over, so nothing about it is still accruing.
    expect(comparisonWindow(2024, 2023, SEPT_18_2026).kind).toBe("fullYear");
    expect(comparisonWindow(2026, 2025, SEPT_18_2026).kind).toBe("samePeriod");
  });

  it("clamps 29 February to the 28th in a year that has no 29th", () => {
    // `new Date(2023, 1, 29)` rolls forward to 1 March, which would let a
    // 1 March event into a window that is supposed to end in February.
    const window = comparisonWindow(2024, 2023, "2024-02-29");
    expect(windowEndKeyInYear(window, 2024)).toBe("2024-02-29");
    expect(windowEndKeyInYear(window, 2023)).toBe("2023-02-28");
    expect(windowEndInYear(window, 2023).getUTCMonth()).toBe(1);
  });

  it("holds the window against an arbitrary compare year, not only the year before", () => {
    // The compare year is the reader's pick and survives a revisit (#188).
    const window = comparisonWindow(2026, 2025, SEPT_18_2026);
    expect(windowEndKeyInYear(window, 2019)).toBe("2019-09-18");
  });
});

describe("comparisonWindow — either year may be the running one", () => {
  // The period bar lets the compare year be the LATER one. Selecting 2025 and
  // comparing against 2026 drew "ggü. 2026" over a full year set against eight
  // months: the same defect with the sides swapped, invisible to a rule that
  // only looked at the selected year.
  it("cuts BOTH sides when the compare year is the still-running one", () => {
    const window = comparisonWindow(2025, 2026, SEPT_18_2026);
    expect(window.kind).toBe("samePeriod");
    expect(window.runningYear).toBe(2026);
    expect(windowEndKeyInYear(window, 2025)).toBe("2025-09-18");
    expect(windowEndKeyInYear(window, 2026)).toBe("2026-09-18");
  });

  it("compares whole years when neither of them is running", () => {
    const window = comparisonWindow(2024, 2025, SEPT_18_2026);
    expect(window.kind).toBe("fullYear");
    expect(window.runningYear).toBeNull();
    expect(windowEndKeyInYear(window, 2024)).toBe("2024-12-31");
  });

  it("falls back to the year before when no comparison is on", () => {
    // `previousEnd` has always described `selectedYear - 1`; a null compare
    // year keeps that meaning rather than inventing one.
    const window = comparisonWindow(2026, null, SEPT_18_2026);
    expect(window.runningYear).toBe(2026);
    expect(window.previousEnd.getUTCFullYear()).toBe(2025);
    expect(comparisonWindow(2024, null, SEPT_18_2026).kind).toBe("fullYear");
  });
});

/**
 * Without an explicit `today`, the window asks the user's PROFILE zone
 * (ADR 0002 Q1) — not the browser's clock. At 23:30 UTC on 31 December it is
 * already New Year in Kiritimati: for a user there 2026 is over and compares
 * whole years; for a user still answered in UTC it is running.
 */
describe("comparisonWindow — today is the profile zone's day", () => {
  afterEach(() => {
    setClockForTests(null);
    useProfileZoneStore.setState({ status: "unknown" });
  });

  it("closes the year at the profile zone's midnight", () => {
    setClockForTests("2026-12-31T23:30:00.000Z");
    useProfileZoneStore.setState({ status: "confirmed" });
    useSettingsStore.setState((s) => ({
      display: { ...s.display, timezone: "Pacific/Kiritimati" },
    }));
    expect(comparisonWindow(2026, 2025).kind).toBe("fullYear");
  });

  it("keeps the year running in UTC until the profile zone is confirmed", () => {
    setClockForTests("2026-12-31T23:30:00.000Z");
    useProfileZoneStore.setState({ status: "missing" });
    expect(comparisonWindow(2026, 2025).kind).toBe("samePeriod");
  });
});
