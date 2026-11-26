import { describe, expect, it } from "vitest";
import {
  isRealDay,
  monthCells,
  readTypedClock,
  readTypedDay,
  showClock,
  showDay,
} from "../dateParts";

describe("typed days are validated, never normalised", () => {
  it("refuses a day that does not exist instead of rolling it into March", () => {
    expect(readTypedDay("31.02.2026", "DD.MM.YYYY")).toEqual({ kind: "invalid" });
    expect(readTypedDay("2026-02-31", "YYYY-MM-DD")).toEqual({ kind: "invalid" });
    expect(readTypedDay("02/31/2026", "MM/DD/YYYY")).toEqual({ kind: "invalid" });
    expect(readTypedDay("29.02.2025", "DD.MM.YYYY")).toEqual({ kind: "invalid" });
  });
  it("accepts a leap day and reads each format in its own order", () => {
    expect(readTypedDay("29.02.2024", "DD.MM.YYYY")).toEqual({ kind: "day", day: "2024-02-29" });
    expect(readTypedDay("11/26/2026", "MM/DD/YYYY")).toEqual({ kind: "day", day: "2026-11-26" });
    expect(readTypedDay("2026-11-26", "YYYY-MM-DD")).toEqual({ kind: "day", day: "2026-11-26" });
    expect(readTypedDay("6.1.2026", "DD.MM.YYYY")).toEqual({ kind: "day", day: "2026-01-06" });
  });
  it("refuses a two-digit year and text, and reads blank as empty", () => {
    expect(readTypedDay("26.11.26", "DD.MM.YYYY")).toEqual({ kind: "invalid" });
    expect(readTypedDay("morgen", "DD.MM.YYYY")).toEqual({ kind: "invalid" });
    expect(readTypedDay("  ", "DD.MM.YYYY")).toEqual({ kind: "empty" });
  });
  it("shows a wire day in the reader's format and nothing for a non-day", () => {
    expect(showDay("2026-11-26", "DD.MM.YYYY")).toBe("26.11.2026");
    expect(showDay("2026-11-26", "MM/DD/YYYY")).toBe("11/26/2026");
    expect(showDay("2026-02-31", "DD.MM.YYYY")).toBe("");
    expect(isRealDay(2026, 13, 1)).toBe(false);
  });
});

describe("typed clock", () => {
  it("reads 24h and 12h forms to HH:mm and refuses 25:00", () => {
    expect(readTypedClock("14:05")).toEqual({ kind: "time", time: "14:05" });
    expect(readTypedClock("2:05 PM")).toEqual({ kind: "time", time: "14:05" });
    expect(readTypedClock("12:00 AM")).toEqual({ kind: "time", time: "00:00" });
    expect(readTypedClock("25:00")).toEqual({ kind: "invalid" });
    expect(readTypedClock("13:00 PM")).toEqual({ kind: "invalid" });
  });
  it("shows the clock the way the setting says", () => {
    expect(showClock("14:05", "24h")).toBe("14:05");
    expect(showClock("14:05", "12h")).toBe("2:05 PM");
    expect(showClock("00:30:15", "12h")).toBe("12:30 AM");
  });
});

describe("monthCells", () => {
  it("starts on Monday for the German calendar and marks days outside the month", () => {
    const cells = monthCells(2026, 11, 1);
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ day: "2026-10-26", inMonth: false });
    expect(cells.find((c) => c.day === "2026-11-01")?.inMonth).toBe(true);
  });
  it("starts on Sunday for the US calendar", () => {
    expect(monthCells(2026, 11, 0)[0].day).toBe("2026-11-01");
  });
});
