import type { DropReason } from "../classify";
import type { IngestResult } from "../ingest";
import type { ImportReport } from "./fileImport";
import type { DayHarvest } from "./dawarichRead";

/**
 * The completeness report of a Dawarich copy (TravTrack plan L6), per month:
 * what Dawarich sent, what was stored, what was held already, what was
 * dropped and why — and what the copy could not get: hours Dawarich still
 * truncated after subdivision, and days it did not answer with points.
 *
 * `complete` only when nothing is in those two lists; every point read was
 * then stored, a duplicate, or deliberately dropped. Pure; the caller keeps
 * it in the copy's row, in the same transaction as the day it describes.
 */

export type MonthReport = {
  read: number;
  stored: number;
  duplicate: number;
  dropped: Record<DropReason, number>;
  truncatedHours: string[];
  unreachableDays: string[];
  daysWithPoints: number;
};

/** Per month `YYYY-MM`. */
export type CopyReport = Record<string, MonthReport>;

export type CopyTotals = Omit<MonthReport, "truncatedHours" | "unreachableDays"> & {
  truncatedHours: number;
  unreachableDays: number;
};

const emptyDropped = (): Record<DropReason, number> => ({
  privacy_zone: 0,
  deleted_range: 0,
  invalid: 0,
  null_island: 0,
});

const emptyMonth = (): MonthReport => ({
  read: 0,
  stored: 0,
  duplicate: 0,
  dropped: emptyDropped(),
  truncatedHours: [],
  unreachableDays: [],
  daysWithPoints: 0,
});

/** The stored report, read defensively: a row is JSON, not a type. */
export function readReport(raw: unknown): CopyReport {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return raw as CopyReport;
}

/** The report with one more day in it; a new object, the old one untouched. */
export function addDay(
  report: CopyReport,
  harvest: DayHarvest,
  results: readonly IngestResult[]
): CopyReport {
  const month = harvest.day.slice(0, 7);
  const before = report[month] ?? emptyMonth();
  const dropped = { ...before.dropped };
  dropped.invalid += harvest.unusable;
  for (const r of results) {
    for (const o of r.outcomes) if (o.outcome === "dropped") dropped[o.reason] += 1;
  }
  const next: MonthReport = {
    read: before.read + harvest.points.length + harvest.unusable,
    stored: before.stored + results.reduce((n, r) => n + r.stored, 0),
    duplicate: before.duplicate + results.reduce((n, r) => n + r.duplicate, 0),
    dropped,
    truncatedHours: [...before.truncatedHours, ...harvest.truncatedHours],
    unreachableDays: harvest.unreachable
      ? [...before.unreachableDays, harvest.day]
      : before.unreachableDays,
    daysWithPoints: before.daysWithPoints + (harvest.points.length > 0 ? 1 : 0),
  };
  return { ...report, [month]: next };
}

export function totalsOf(report: CopyReport): CopyTotals {
  const totals: CopyTotals = {
    read: 0,
    stored: 0,
    duplicate: 0,
    dropped: emptyDropped(),
    truncatedHours: 0,
    unreachableDays: 0,
    daysWithPoints: 0,
  };
  for (const m of Object.values(report)) {
    totals.read += m.read;
    totals.stored += m.stored;
    totals.duplicate += m.duplicate;
    for (const k of Object.keys(totals.dropped) as DropReason[]) {
      totals.dropped[k] += m.dropped?.[k] ?? 0;
    }
    totals.truncatedHours += m.truncatedHours?.length ?? 0;
    totals.unreachableDays += m.unreachableDays?.length ?? 0;
    totals.daysWithPoints += m.daysWithPoints ?? 0;
  }
  return totals;
}

export const isComplete = (report: CopyReport): boolean => {
  const t = totalsOf(report);
  return t.truncatedHours === 0 && t.unreachableDays === 0;
};

/** The months, oldest first, as the client lists them. */
export const monthsOf = (report: CopyReport) =>
  Object.keys(report)
    .sort()
    .map((month) => ({ month, ...report[month] }));

/** The totals in a file import's report shape, for the list of imports. */
export function asImportReport(report: CopyReport): ImportReport {
  const t = totalsOf(report);
  return {
    read: t.read,
    stored: t.stored,
    duplicate: t.duplicate,
    dropped: t.dropped,
    withoutTime: 0,
  };
}
