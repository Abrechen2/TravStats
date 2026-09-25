import { describe, it, expect } from "vitest";

import {
  suggestedCruiseEndDate,
  withCruiseDayNumbers,
  withDerivedStopDates,
} from "../cruiseDayNumbers";
import type { CruiseStopInput } from "../../../types";

/** The owner's four examples from forgejo#126, and the one the bug was found by. */

const stop = (dayNumber: number, originalDay?: number | null): CruiseStopInput => ({
  portId: null,
  dayNumber,
  isAtSea: false,
  ...(originalDay !== undefined ? { originalDay } : {}),
});
const days = (stops: CruiseStopInput[]) => withCruiseDayNumbers(stops).map((s) => s.dayNumber);

describe("withCruiseDayNumbers", () => {
  it("keeps the loaded days of an untouched cruise", () => {
    expect(days([stop(1), stop(8)])).toEqual([1, 8]);
  });

  it("gives a sea day added between them the next free day, and keeps disembarkation on day 8", () => {
    expect(days([stop(1), stop(1, null), stop(8)])).toEqual([1, 2, 8]);
  });

  it("closes no gap when the middle stop is removed", () => {
    expect(days([stop(1), stop(8)])).toEqual([1, 8]);
  });

  it("pushes a stop moved behind a later day to the next free day", () => {
    expect(days([stop(1), stop(8), stop(4)])).toEqual([1, 8, 9]);
  });

  it("remembers which stop was added, across a second edit", () => {
    // Added at the end first (day 9 behind day 8), then moved up between 1 and 8.
    const afterAdd = withCruiseDayNumbers([stop(1), stop(8), stop(1, null)]);
    expect(afterAdd.map((s) => s.dayNumber)).toEqual([1, 8, 9]);
    const movedUp = [afterAdd[0], afterAdd[2], afterAdd[1]];
    expect(days(movedUp)).toEqual([1, 2, 8]);
  });
});

describe("withDerivedStopDates", () => {
  const dated = (dayNumber: number, extra: Partial<CruiseStopInput> = {}): CruiseStopInput => ({
    ...stop(dayNumber),
    ...extra,
  });
  const dates = (stops: CruiseStopInput[], start: string) =>
    withDerivedStopDates(stops, start).map((s) => s.date?.slice(0, 10) ?? null);

  it("dates an undated stop from the start date and its day of the cruise", () => {
    expect(dates([dated(1), dated(8)], "2026-01-01")).toEqual(["2026-01-01", "2026-01-08"]);
  });

  it("crosses a month end in UTC", () => {
    expect(dates([dated(3)], "2026-01-30")).toEqual(["2026-02-01"]);
  });

  it("never overwrites a date the stop was loaded with or the user typed", () => {
    const loaded = dated(2, { date: "2026-05-05T00:00:00.000Z" });
    const typed = dated(3, { date: "2026-06-06T00:00:00.000Z", dateSource: "user" });
    expect(dates([loaded, typed], "2026-01-01")).toEqual(["2026-05-05", "2026-06-06"]);
  });

  it("keeps a cleared date cleared once the user owns it", () => {
    expect(dates([dated(2, { date: null, dateSource: "user" })], "2026-01-01")).toEqual([null]);
  });

  it("lets a derived date follow its day and the start date", () => {
    const [first] = withDerivedStopDates([dated(2)], "2026-01-01");
    expect(first.date).toBe("2026-01-02T00:00:00.000Z");
    expect(dates([{ ...first, dayNumber: 5 }], "2026-01-01")).toEqual(["2026-01-05"]);
    expect(dates([first], "2026-03-01")).toEqual(["2026-03-02"]);
  });

  it("takes a derived date back when the start date is cleared, and abstains without one", () => {
    const [first] = withDerivedStopDates([dated(2)], "2026-01-01");
    expect(dates([first], "")).toEqual([null]);
    expect(dates([dated(2)], "")).toEqual([null]);
  });

  it("returns the same array when nothing changes, so an effect cannot loop", () => {
    const once = withDerivedStopDates([dated(1)], "2026-01-01");
    expect(withDerivedStopDates(once, "2026-01-01")).toBe(once);
    const none = [dated(1)];
    expect(withDerivedStopDates(none, "")).toBe(none);
  });
});

describe("suggestedCruiseEndDate", () => {
  it("ends on the highest day of the cruise", () => {
    expect(suggestedCruiseEndDate("2026-01-01", [stop(1), stop(8), stop(4)])).toBe("2026-01-08");
  });

  it("abstains without a start date, without stops, or with only day 1", () => {
    expect(suggestedCruiseEndDate("", [stop(1), stop(8)])).toBe("");
    expect(suggestedCruiseEndDate("2026-01-01", [])).toBe("");
    expect(suggestedCruiseEndDate("2026-01-01", [stop(1)])).toBe("");
  });
});
