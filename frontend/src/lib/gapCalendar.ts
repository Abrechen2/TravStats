import { addDays, daysInMonth } from "../shared/time/calendar";
import type { GapCalendar, GapRun, GapState } from "./api/gapCalendar";

/** True for a real calendar day written `YYYY-MM-DD` (2027-02-29 is not one). */
export function isDayString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDays(value, 0) === value;
}

export type GapCell = { day: string; state: GapState; inferred?: true };
export type GapMonth = { month: string; cells: GapCell[] };

/** The state of every day, from the server's runs: 12 months of their own length. */
export function gapMonths(data: GapCalendar): GapMonth[] {
  const stateOf = new Map<string, { state: GapState; inferred?: true }>();
  for (const run of data.runs) {
    for (let d = run.from; d <= run.to; d = addDays(d, 1))
      stateOf.set(d, { state: run.state, inferred: run.inferred });
  }
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${data.year}-${String(i + 1).padStart(2, "0")}`;
    const cells = Array.from({ length: daysInMonth(data.year, i + 1) }, (_, k) => {
      const day = `${month}-${String(k + 1).padStart(2, "0")}`;
      // A day the server did not name is never drawn as a gap: it is outside.
      const found = stateOf.get(day);
      return found?.inferred
        ? { day, state: found.state, inferred: true as const }
        : { day, state: found?.state ?? ("outside" as const) };
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

/** The dates a gap hands to a create form: its first day, and its last when it spans more than one. */
export type GapDates = { from: string; to: string };

/**
 * `?addFrom=&addTo=` as dates. A first day that is not a real day gives null (the form opens as
 * if no gap had been named); a missing or earlier last day is the first day.
 */
export function gapDatesFromParams(from: string | null, to: string | null): GapDates | null {
  if (from === null || !isDayString(from)) return null;
  return { from, to: to !== null && isDayString(to) && to >= from ? to : from };
}

/** What the gap calendar hands the import panel's manual form (`DomainImportPanel.initialManual`). */
export type GapPrefill = { kind: "gap"; dates: GapDates };

export const gapPrefill = (dates: GapDates): GapPrefill => ({ kind: "gap", dates });

export function isGapPrefill(value: unknown): value is GapPrefill {
  return typeof value === "object" && value !== null && (value as GapPrefill).kind === "gap";
}

/** The create form each domain opens, in the order the gap menu lists them. */
export const GAP_CREATE_TARGETS = [
  { id: "trip", domain: null, path: "/trips", label: "track:gaps.target.trip" },
  { id: "flight", domain: "flight", path: "/flights", label: "track:gaps.target.flight" },
  { id: "lodging", domain: "lodging", path: "/lodging", label: "track:gaps.target.lodging" },
  { id: "rail", domain: "rail", path: "/rail", label: "track:gaps.target.rail" },
  { id: "bus", domain: "bus", path: "/bus", label: "track:gaps.target.bus" },
  { id: "ferry", domain: "ferry", path: "/ferry", label: "track:gaps.target.ferry" },
  { id: "rental", domain: "rental", path: "/rentals", label: "track:gaps.target.rental" },
  { id: "place", domain: "poi", path: "/places", label: "track:gaps.target.place" },
] as const;

/** Where a target opens its create form for a gap. */
export function gapCreateUrl(path: string, gap: GapDates): string {
  return `${path}?addFrom=${gap.from}&addTo=${gap.to}`;
}
