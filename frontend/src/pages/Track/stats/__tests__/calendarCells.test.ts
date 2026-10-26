import { describe, expect, it } from "vitest";
import { calendarMonths, kmStep } from "../calendarCells";
import { kmBars } from "../TrackKmChart";

/**
 * The Statistik calendar and bars (plan T5.3): a recorded 0 is a measurement,
 * an absent day of a settled month was not recorded, a month still being
 * prepared or not known says so — and a month without data has no bar.
 */

describe("calendarMonths", () => {
  const months = calendarMonths(
    {
      year: 2026,
      days: [
        { day: "2026-03-02", kmGround: 0, recorded: true },
        { day: "2026-03-03", kmGround: 61.2, recorded: true },
        { day: "2026-10-01", kmGround: 4, recorded: true },
      ],
      pending: ["2026-10"],
      unavailable: ["2026-01"],
    },
    "2026-10-25"
  );
  const cell = (day: string) => months.flatMap((m) => m.cells).find((c) => c.day === day)!;

  it("one cell per day of every month", () => {
    expect(months).toHaveLength(12);
    expect(months[1].cells).toHaveLength(28);
    expect(months.reduce((n, m) => n + m.cells.length, 0)).toBe(365);
  });

  it("tells recorded, not recorded, pending, unknown and future apart", () => {
    expect(cell("2026-03-02")).toEqual({ day: "2026-03-02", state: "recorded", km: 0 });
    expect(cell("2026-03-04")).toEqual({ day: "2026-03-04", state: "none", km: null });
    expect(cell("2026-10-01").state).toBe("recorded");
    expect(cell("2026-10-02").state).toBe("pending");
    expect(cell("2026-01-15").state).toBe("unavailable");
    expect(cell("2026-11-01").state).toBe("future");
    expect(months[9].state).toBe("pending");
    expect(months[0].state).toBe("unavailable");
  });

  it("steps the colour by kilometres", () => {
    expect([0, 4.9, 5, 49, 150, 900].map(kmStep)).toEqual([0, 0, 1, 2, 4, 4]);
  });
});

describe("kmBars", () => {
  it("a bar for a month with values; none for a month without, or being computed", () => {
    const bars = kmBars(
      {
        months: [
          {
            month: "2026-03",
            kmGround: 100,
            countries: [],
            cities: null,
            daysWithData: 1,
            daysPaused: 0,
          },
          {
            month: "2026-04",
            kmGround: 0,
            countries: [],
            cities: null,
            daysWithData: 1,
            daysPaused: 0,
          },
          {
            month: "2026-05",
            kmGround: 9,
            countries: [],
            cities: null,
            daysWithData: 1,
            daysPaused: 0,
          },
        ],
        pending: ["2026-05"],
      },
      2026,
      (km) => km * 2,
      (m) => m
    );
    expect(bars).toHaveLength(12);
    expect(bars.slice(1, 6).map((b) => b.value)).toEqual([null, 200, 0, null, null]);
  });
});
