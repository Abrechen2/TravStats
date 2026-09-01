export type Granularity = "month" | "year";
export type WindowKind = "rolling12m" | "year" | "all";

export interface ResolvedWindow {
  from: Date;
  to: Date;
  prevFrom: Date | null;
  prevTo: Date | null;
}

/** First day (UTC) of the month `offset` months away from `d`. */
function startOfMonthUTC(d: Date, offset = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
}

/**
 * Resolve the current + previous window bounds. `now` is injected so the
 * logic is pure and testable. Explicit fromDate/toDate take precedence and
 * yield no previous window (an arbitrary range has no natural predecessor).
 */
export function resolveWindow(
  window: WindowKind,
  year: number | undefined,
  fromDate: string | undefined,
  toDate: string | undefined,
  now: Date,
): ResolvedWindow {
  if (fromDate || toDate) {
    return {
      from: fromDate ? new Date(fromDate) : new Date(0),
      to: toDate ? new Date(toDate) : startOfMonthUTC(now, 1),
      prevFrom: null,
      prevTo: null,
    };
  }

  if (window === "year") {
    const y = year ?? now.getUTCFullYear();
    return {
      from: new Date(Date.UTC(y, 0, 1)),
      to: new Date(Date.UTC(y + 1, 0, 1)),
      prevFrom: new Date(Date.UTC(y - 1, 0, 1)),
      prevTo: new Date(Date.UTC(y, 0, 1)),
    };
  }

  if (window === "all") {
    return {
      from: new Date(0),
      to: startOfMonthUTC(now, 1),
      prevFrom: null,
      prevTo: null,
    };
  }

  // rolling12m — 12 whole months ending with the current month
  const to = startOfMonthUTC(now, 1);
  const from = startOfMonthUTC(now, -11);
  const prevFrom = startOfMonthUTC(now, -23);
  return { from, to, prevFrom, prevTo: from };
}

export interface DatedRow {
  date: Date;
  distanceKm: number;
  durationMin: number;
}

export interface TimeseriesPoint {
  period: string;
  count: number;
  distanceKm: number;
  durationMin: number;
}

export interface WindowTotals {
  count: number;
  distanceKm: number;
  durationMin: number;
}

function periodKey(d: Date, g: Granularity): string {
  const y = d.getUTCFullYear();
  if (g === "year") return String(y);
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Ordered list of bucket-start Dates covering [from, to). */
function bucketStarts(from: Date, to: Date, g: Granularity): Date[] {
  const out: Date[] = [];
  let cur =
    g === "year"
      ? new Date(Date.UTC(from.getUTCFullYear(), 0, 1))
      : new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cur.getTime() < to.getTime()) {
    out.push(cur);
    cur =
      g === "year"
        ? new Date(Date.UTC(cur.getUTCFullYear() + 1, 0, 1))
        : new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return out;
}

export function bucketSeries(
  rows: DatedRow[],
  granularity: Granularity,
  from: Date,
  to: Date,
): TimeseriesPoint[] {
  const buckets = new Map<string, TimeseriesPoint>();
  for (const start of bucketStarts(from, to, granularity)) {
    const key = periodKey(start, granularity);
    buckets.set(key, { period: key, count: 0, distanceKm: 0, durationMin: 0 });
  }
  for (const r of rows) {
    if (r.date.getTime() < from.getTime() || r.date.getTime() >= to.getTime()) continue;
    const key = periodKey(r.date, granularity);
    const point = buckets.get(key);
    if (!point) continue;
    buckets.set(key, {
      period: point.period,
      count: point.count + 1,
      distanceKm: point.distanceKm + r.distanceKm,
      durationMin: point.durationMin + r.durationMin,
    });
  }
  return Array.from(buckets.values());
}

/**
 * Keep only the rows whose calendar day falls in [from, to).
 *
 * Exists because the window is decided TWICE otherwise. `bucketSeries` filters
 * internally, but `sumTotals` does not — so a caller that widens its database
 * query (which the flight fetcher must, see `fetchFlightDatedRows`) would get a
 * correct series beside totals that quietly counted the margin rows too.
 *
 * One definition of "in the window", applied once by the caller, and both
 * consumers then agree by construction.
 */
export function withinWindow(rows: DatedRow[], from: Date, to: Date): DatedRow[] {
  return rows.filter((r) => r.date.getTime() >= from.getTime() && r.date.getTime() < to.getTime());
}

export function sumTotals(rows: DatedRow[]): WindowTotals {
  return rows.reduce<WindowTotals>(
    (acc, r) => ({
      count: acc.count + 1,
      distanceKm: acc.distanceKm + r.distanceKm,
      durationMin: acc.durationMin + r.durationMin,
    }),
    { count: 0, distanceKm: 0, durationMin: 0 },
  );
}

/**
 * Drop leading and trailing zero-count buckets while keeping interior gaps.
 * Used for the unbounded "all-time" window, whose series would otherwise
 * zero-fill from the Unix epoch (1970) to today — a long run of empty
 * buckets before the user's first record. Interior zero buckets (a gap year
 * between two active years) are preserved because they carry meaning.
 */
export function trimZeroEdges(series: TimeseriesPoint[]): TimeseriesPoint[] {
  let start = 0;
  let end = series.length;
  while (start < end && series[start].count === 0) start += 1;
  while (end > start && series[end - 1].count === 0) end -= 1;
  return series.slice(start, end);
}
