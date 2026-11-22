import { addDays, daysInMonth } from "../shared/time/calendar";
import type { GapCalendar, GapRun, GapState } from "./api/gapCalendar";

/** True for a real calendar day written `YYYY-MM-DD` (2027-02-29 is not one). */
export function isDayString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDays(value, 0) === value;
}

export type GapCell = { day: string; state: GapState };
export type GapMonth = { month: string; cells: GapCell[] };

/** The state of every day, from the server's runs: 12 months of their own length. */
export function gapMonths(data: GapCalendar): GapMonth[] {
  const stateOf = new Map<string, GapState>();
  for (const run of data.runs) {
    for (let d = run.from; d <= run.to; d = addDays(d, 1)) stateOf.set(d, run.state);
  }
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${data.year}-${String(i + 1).padStart(2, "0")}`;
    const cells = Array.from({ length: daysInMonth(data.year, i + 1) }, (_, k) => {
      const day = `${month}-${String(k + 1).padStart(2, "0")}`;
      // A day the server did not name is never drawn as a gap: it is outside.
      return { day, state: stateOf.get(day) ?? ("outside" as const) };
    });
    return { month, cells };
  });
}

/** The unknown stretches of a month ("YYYY-MM"), cut at the month's edges. */
export function unknownStretches(data: GapCalendar, month: string): GapRun[] {
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5))))}`;
  return data.runs
    .filter((r) => r.state === "unknown" && r.to >= first && r.from <= last)
    .map((r) => ({ ...r, from: r.from < first ? first : r.from, to: r.to > last ? last : r.to }));
}
