import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import type { TimeMigrationReason, TimeMigrationTable } from "../../schemas/timeMigration";
import { resolveZone } from "../../shared/time/zoneOf";
import { TzUnresolvedError } from "../../shared/time/errors";
import { legacyDayOf } from "../../shared/time/legacyValues";
import { toDbDate } from "../../shared/time/localDate";

/**
 * What every table module of the backfill shares (ADR 0002 phase 3b): the
 * ledger entry, the zone of a place with the reason it has none, a legacy day,
 * and the loop that writes one row's new columns and its ledger entries in
 * one transaction.
 *
 * The contract every module keeps:
 * - it writes ONLY new time-model columns and the ledger — never a legacy
 *   column, so undoing the backfill is `SET <new columns> = NULL`;
 * - it never picks a row whose new columns are already filled (a phase-2
 *   write path or a seed got there first — those rows are left exactly as they
 *   are) nor one the ledger already holds (a second run changes nothing);
 * - every value it converts, and every value it could not, gets a ledger row.
 */

export interface LedgerEntry {
  columnName: string;
  legacyValue: string | null;
  newValue: string | null;
  zone: string | null;
  rule: string;
  /** Set = left open for the owner; null = converted. */
  reason: TimeMigrationReason | null;
}

export interface RowWrite {
  rowId: string;
  userId: string | null;
  /** The new columns; never a legacy one. */
  data: Record<string, unknown>;
  entries: LedgerEntry[];
}

export interface TableSummary {
  table: TimeMigrationTable;
  /** Rows the module wrote. */
  converted: number;
  /** Of those, rows with at least one value left open. */
  open: number;
  /** Users with an open value — whose inbox the runner refreshes. */
  usersWithOpen: Set<string>;
}

export const iso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

/** Row ids the ledger already holds for a table — a second run skips them. */
export async function ledgeredRowIds(table: TimeMigrationTable): Promise<Set<string>> {
  const rows = await prisma.timeMigrationLedger.findMany({
    where: { tableName: table },
    select: { rowId: true },
    distinct: ["rowId"],
  });
  return new Set(rows.map((r) => r.rowId));
}

export type PlaceZone =
  { zone: string; reason: null } | { zone: null; reason: TimeMigrationReason };

/**
 * The zone of a place for the backfill: `resolveZone` (catalogue, then
 * coordinates), with `0,0` read as what imports mean by it — no position.
 * A lookup that cannot RUN throws (`TIMEZONE_LOOKUP_UNAVAILABLE`) and fails the
 * whole backfill; it is never recorded as "no zone".
 */
export function placeZone(place: {
  catalogueZone?: string | null;
  lat?: number | null;
  lon?: number | null;
}): PlaceZone {
  const placeholder = place.lat === 0 && place.lon === 0;
  const lat = placeholder ? null : place.lat;
  const lon = placeholder ? null : place.lon;
  try {
    return {
      zone: resolveZone({ catalogueZone: place.catalogueZone, lat, lon }).zone,
      reason: null,
    };
  } catch (error) {
    if (!(error instanceof TzUnresolvedError)) throw error;
    const hasPosition = typeof lat === "number" && typeof lon === "number";
    return { zone: null, reason: hasPosition ? "zone_unresolved" : "no_position" };
  }
}

/**
 * A legacy day column as its `@db.Date` value and ledger entry. The
 * 10:00–11:59 anchor keeps its UTC date and is left open
 * (`day_anchor_ambiguous`).
 */
export function dayColumn(
  anchor: Date,
  columnName: string,
  zone: string | null = null
): { value: Date; entry: LedgerEntry } {
  const reading = legacyDayOf(anchor);
  return {
    value: toDbDate(reading.day),
    entry: {
      columnName,
      legacyValue: anchor.toISOString(),
      newValue: reading.day,
      zone,
      rule: `day.${reading.rule}`,
      reason: reading.ambiguous ? "day_anchor_ambiguous" : null,
    },
  };
}

/** Writes each row's new columns and ledger entries, one transaction per row. */
export async function writeRows(
  table: TimeMigrationTable,
  writes: RowWrite[],
  update: (rowId: string, data: Record<string, unknown>) => Prisma.PrismaPromise<unknown>
): Promise<TableSummary> {
  const summary: TableSummary = { table, converted: 0, open: 0, usersWithOpen: new Set() };
  for (const write of writes) {
    if (write.entries.length === 0) continue;
    const hasOpen = write.entries.some((e) => e.reason !== null);
    await prisma.$transaction([
      update(write.rowId, write.data),
      prisma.timeMigrationLedger.createMany({
        data: write.entries.map((e) => ({
          tableName: table,
          rowId: write.rowId,
          userId: write.userId,
          columnName: e.columnName,
          legacyValue: e.legacyValue,
          newValue: e.newValue,
          zone: e.zone,
          rule: e.rule,
          reason: e.reason,
          status: e.reason ? "open" : "resolved",
        })),
      }),
    ]);
    summary.converted += 1;
    if (hasOpen) {
      summary.open += 1;
      if (write.userId) summary.usersWithOpen.add(write.userId);
    }
  }
  return summary;
}
