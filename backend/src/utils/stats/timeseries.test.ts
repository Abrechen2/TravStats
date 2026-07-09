import { describe, it, expect } from "@jest/globals";
import {
  resolveWindow,
  bucketSeries,
  sumTotals,
  trimZeroEdges,
  type DatedRow,
  type TimeseriesPoint,
} from "./timeseries";

const NOW = new Date(Date.UTC(2026, 6, 15)); // 2026-07-15

const row = (iso: string, km: number, min: number): DatedRow => ({
  date: new Date(iso),
  distanceKm: km,
  durationMin: min,
});

describe("resolveWindow", () => {
  it("rolling12m spans the 12 months ending with the current month", () => {
    const w = resolveWindow("rolling12m", undefined, undefined, undefined, NOW);
    // 'to' is the exclusive start-of-next-month; 'from' is 12 months before it
    expect(w.to.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(w.from.toISOString()).toBe("2025-08-01T00:00:00.000Z");
    expect(w.prevTo!.toISOString()).toBe("2025-08-01T00:00:00.000Z");
    expect(w.prevFrom!.toISOString()).toBe("2024-08-01T00:00:00.000Z");
  });

  it("year window covers the calendar year and previous year", () => {
    const w = resolveWindow("year", 2024, undefined, undefined, NOW);
    expect(w.from.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(w.prevFrom!.toISOString()).toBe("2023-01-01T00:00:00.000Z");
    expect(w.prevTo!.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("all window has no previous window", () => {
    const w = resolveWindow("all", undefined, undefined, undefined, NOW);
    expect(w.from.getTime()).toBe(0);
    expect(w.to.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(w.prevFrom).toBeNull();
    expect(w.prevTo).toBeNull();
  });

  it("explicit fromDate/toDate override the window and have no previous", () => {
    const w = resolveWindow("rolling12m", undefined, "2023-03-01", "2023-06-01", NOW);
    expect(w.from.toISOString()).toBe("2023-03-01T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2023-06-01T00:00:00.000Z");
    expect(w.prevFrom).toBeNull();
    expect(w.prevTo).toBeNull();
  });
});

describe("bucketSeries", () => {
  it("zero-fills every month in the window and slots rows by month", () => {
    const from = new Date(Date.UTC(2025, 0, 1));
    const to = new Date(Date.UTC(2025, 3, 1)); // Jan, Feb, Mar
    const rows = [row("2025-01-10", 100, 60), row("2025-01-20", 50, 30), row("2025-03-05", 200, 120)];
    const series = bucketSeries(rows, "month", from, to);
    expect(series.map((p) => p.period)).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(series[0]).toEqual({ period: "2025-01", count: 2, distanceKm: 150, durationMin: 90 });
    expect(series[1]).toEqual({ period: "2025-02", count: 0, distanceKm: 0, durationMin: 0 });
    expect(series[2]).toEqual({ period: "2025-03", count: 1, distanceKm: 200, durationMin: 120 });
  });

  it("buckets by year when granularity is year", () => {
    const from = new Date(Date.UTC(2022, 0, 1));
    const to = new Date(Date.UTC(2025, 0, 1)); // 2022, 2023, 2024
    const rows = [row("2022-05-01", 10, 5), row("2024-11-01", 20, 8)];
    const series = bucketSeries(rows, "year", from, to);
    expect(series.map((p) => p.period)).toEqual(["2022", "2023", "2024"]);
    expect(series[0].count).toBe(1);
    expect(series[1].count).toBe(0);
    expect(series[2].count).toBe(1);
  });

  it("excludes rows on the exclusive upper bound", () => {
    const from = new Date(Date.UTC(2025, 0, 1));
    const to = new Date(Date.UTC(2025, 1, 1));
    const series = bucketSeries([row("2025-02-01", 1, 1)], "month", from, to);
    expect(series).toEqual([{ period: "2025-01", count: 0, distanceKm: 0, durationMin: 0 }]);
  });
});

describe("sumTotals", () => {
  it("sums count, distance and duration", () => {
    expect(sumTotals([row("2025-01-01", 100, 60), row("2025-02-01", 50, 30)])).toEqual({
      count: 2,
      distanceKm: 150,
      durationMin: 90,
    });
  });
  it("returns zeros for an empty list", () => {
    expect(sumTotals([])).toEqual({ count: 0, distanceKm: 0, durationMin: 0 });
  });
});

describe("trimZeroEdges", () => {
  const pt = (period: string, count: number): TimeseriesPoint => ({
    period,
    count,
    distanceKm: count * 100,
    durationMin: count * 60,
  });

  it("removes leading and trailing zero buckets but keeps interior gaps", () => {
    const series = [pt("1970", 0), pt("2019", 0), pt("2020", 3), pt("2021", 0), pt("2022", 5), pt("2023", 0)];
    expect(trimZeroEdges(series).map((p) => p.period)).toEqual(["2020", "2021", "2022"]);
  });

  it("returns an empty array when every bucket is zero", () => {
    expect(trimZeroEdges([pt("1970", 0), pt("1971", 0)])).toEqual([]);
  });

  it("leaves a series with no edge zeros unchanged", () => {
    const series = [pt("2020", 1), pt("2021", 2)];
    expect(trimZeroEdges(series)).toEqual(series);
  });

  it("returns an empty array for empty input", () => {
    expect(trimZeroEdges([])).toEqual([]);
  });
});
