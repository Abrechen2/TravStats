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
