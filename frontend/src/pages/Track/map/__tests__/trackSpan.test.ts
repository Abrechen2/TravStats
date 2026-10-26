import { describe, expect, it } from "vitest";
import {
  activeSpanPreset,
  customSpan,
  isLongSpan,
  parseSpan,
  presetSpan,
  spanDays,
  spanPath,
  stepSpan,
} from "../trackSpan";

/**
 * The map's spans (plan T5.3): the URL keeps `/track/:date` as the last day,
 * a month or a year never reaches past today, and a step moves by the span's
 * own size.
 */

const TODAY = "2026-10-25";
const q = (s: string) => new URLSearchParams(s);

describe("trackSpan", () => {
  it("reads every kind from the URL, and a day link stays a day", () => {
    expect(parseSpan(undefined, q(""), TODAY)).toEqual({
      kind: "day",
      fromDay: TODAY,
      toDay: TODAY,
    });
    expect(parseSpan("2026-10-20", q("range=7"), TODAY)).toEqual({
      kind: "week",
      fromDay: "2026-10-14",
      toDay: "2026-10-20",
    });
    expect(parseSpan("2026-10-03", q("range=month"), TODAY)).toEqual({
      kind: "month",
      fromDay: "2026-10-01",
      toDay: TODAY,
    });
    expect(parseSpan("2026-02-10", q("range=month"), TODAY)).toEqual({
      kind: "month",
      fromDay: "2026-02-01",
      toDay: "2026-02-28",
    });
    expect(parseSpan("2025-06-01", q("range=year"), TODAY)).toEqual({
      kind: "year",
      fromDay: "2025-01-01",
      toDay: "2025-12-31",
    });
    expect(parseSpan("2026-10-10", q("range=custom&from=2026-09-01"), TODAY)).toEqual({
      kind: "custom",
      fromDay: "2026-09-01",
      toDay: "2026-10-10",
    });
  });

  it("a span picked backwards is the same span; a future day is today", () => {
    expect(parseSpan("2026-09-01", q("range=custom&from=2026-10-10"), TODAY)).toMatchObject({
      fromDay: "2026-09-01",
      toDay: "2026-10-10",
    });
    expect(parseSpan("2027-01-01", q(""), TODAY).toDay).toBe(TODAY);
    expect(customSpan("2026-11-01", "2026-10-01", TODAY)).toEqual({
      kind: "custom",
      fromDay: "2026-10-01",
      toDay: TODAY,
    });
  });

  it("round-trips through its path", () => {
    const spans = [
      parseSpan(undefined, q(""), TODAY),
      parseSpan("2026-10-20", q("range=7"), TODAY),
      parseSpan("2026-09-30", q("range=month"), TODAY),
      parseSpan("2025-12-31", q("range=year"), TODAY),
      parseSpan("2026-10-10", q("range=custom&from=2026-09-01"), TODAY),
    ];
    for (const span of spans) {
      const [path, query = ""] = spanPath(span, TODAY).split("?");
      const date = path.split("/")[2];
      expect(parseSpan(date, q(query), TODAY)).toEqual(span);
    }
  });

  it("steps a month by a month and a year by a year", () => {
    const oct = parseSpan(TODAY, q("range=month"), TODAY);
    expect(stepSpan(oct, -1, TODAY)).toEqual({
      kind: "month",
      fromDay: "2026-09-01",
      toDay: "2026-09-30",
    });
    const jan = parseSpan("2026-01-15", q("range=month"), TODAY);
    expect(stepSpan(jan, -1, TODAY).fromDay).toBe("2025-12-01");
    const year = parseSpan(TODAY, q("range=year"), TODAY);
    expect(stepSpan(year, -1, TODAY)).toEqual({
      kind: "year",
      fromDay: "2025-01-01",
      toDay: "2025-12-31",
    });
    const custom = customSpan("2026-10-01", "2026-10-10", TODAY);
    expect(stepSpan(custom, -1, TODAY)).toEqual({
      kind: "custom",
      fromDay: "2026-09-21",
      toDay: "2026-09-30",
    });
  });

  it("presets and which one is active; only month, year and custom are long", () => {
    const day = parseSpan("2026-10-10", q(""), TODAY);
    expect(presetSpan("month", TODAY, day)).toMatchObject({ fromDay: "2026-10-01", toDay: TODAY });
    expect(presetSpan("year", TODAY, day)).toMatchObject({ fromDay: "2026-01-01", toDay: TODAY });
    expect(activeSpanPreset(day, TODAY)).toBeNull();
    expect(activeSpanPreset(presetSpan("yesterday", TODAY, day), TODAY)).toBe("yesterday");
    expect(isLongSpan(day)).toBe(false);
    expect(isLongSpan(presetSpan("week", TODAY, day))).toBe(false);
    expect(isLongSpan(presetSpan("year", TODAY, day))).toBe(true);
    expect(spanDays(presetSpan("year", TODAY, day))).toBe(298);
  });
});
