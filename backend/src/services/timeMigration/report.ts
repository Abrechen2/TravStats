import { prisma } from "../../db";
import { TIME_FLAG_KINDS } from "../../schemas/timeMigration";
import {
  ENTITY_OF_TABLE,
  TIME_MIGRATION_REASONS,
  TIME_MIGRATION_TABLES,
  type TimeMigrationReason,
  type TimeMigrationReport,
  type TimeMigrationStatus,
  type TimeMigrationTable,
} from "../../schemas/timeMigration";
import { kindOf, settleTimeLedger } from "./openQuestions";
import { loadRowLinks, type RowLink } from "./rowLinks";
import { backfillRunState } from "./state";
import { FILLED_SQL } from "./tables";

/**
 * The migration report the owner reads on the RC server before promotion
 * (ADR 0002 phase 3b): what the backfill converted, what it left open and
 * why, what it found already filled, and the inbox questions it raised.
 * Computed from the ledger and the tables each time — nothing is cached, so
 * the report cannot describe a state the database is no longer in.
 */

/** Open rows listed in full up to this many; the counts are never capped. */
export const OPEN_ROWS_CAP = 1000;

const isTable = (value: string): value is TimeMigrationTable =>
  (TIME_MIGRATION_TABLES as readonly string[]).includes(value);
const isReason = (value: string | null): value is TimeMigrationReason =>
  value !== null && (TIME_MIGRATION_REASONS as readonly string[]).includes(value);

interface RowCounts {
  open: number;
  converted: number;
  answered: number;
}

async function rowCounts(): Promise<Map<string, RowCounts>> {
  const rows = await prisma.$queryRaw<
    Array<{ table_name: string; open: bigint; converted: bigint; answered: bigint }>
  >`
    SELECT table_name,
           count(*) FILTER (WHERE has_open)                      AS open,
           count(*) FILTER (WHERE NOT has_open AND NOT asked)    AS converted,
           count(*) FILTER (WHERE NOT has_open AND asked)        AS answered
      FROM (SELECT table_name, row_id,
                   bool_or(status = 'open')     AS has_open,
                   bool_or(reason IS NOT NULL)  AS asked
              FROM time_migration_ledger GROUP BY table_name, row_id) per_row
     GROUP BY table_name`;
  return new Map(
    rows.map((r) => [
      r.table_name,
      { open: Number(r.open), converted: Number(r.converted), answered: Number(r.answered) },
    ])
  );
}

async function alreadyFilled(table: TimeMigrationTable): Promise<number> {
  // Both names are constants of this module (FILLED_SQL), never input.
  const [row] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*) AS n FROM "${table}" t
      WHERE (${FILLED_SQL[table]})
        AND NOT EXISTS (SELECT 1 FROM time_migration_ledger l
                         WHERE l.table_name = $1 AND l.row_id = t.id::text)`,
    table
  );
  return Number(row?.n ?? 0);
}

async function tableReports(): Promise<TimeMigrationReport["tables"]> {
  const [counts, byRule, byReason] = await Promise.all([
    rowCounts(),
    prisma.timeMigrationLedger.groupBy({
      by: ["tableName", "rule", "status"],
      _count: { _all: true },
      orderBy: [{ tableName: "asc" }, { rule: "asc" }, { status: "asc" }],
    }),
    prisma.timeMigrationLedger.groupBy({
      by: ["tableName", "reason"],
      where: { status: "open" },
      _count: { _all: true },
      orderBy: [{ tableName: "asc" }, { reason: "asc" }],
    }),
  ]);
  const reports: TimeMigrationReport["tables"] = [];
  for (const table of TIME_MIGRATION_TABLES) {
    reports.push({
      table,
      converted: counts.get(table)?.converted ?? 0,
      open: counts.get(table)?.open ?? 0,
      answered: counts.get(table)?.answered ?? 0,
      alreadyFilled: await alreadyFilled(table),
      rules: byRule
        .filter((r) => r.tableName === table)
        .map((r) => ({
          rule: r.rule,
          status: r.status as TimeMigrationStatus,
          count: r._count._all,
        })),
      reasons: byReason
        .filter((r) => r.tableName === table && isReason(r.reason))
        .map((r) => ({ reason: r.reason as TimeMigrationReason, count: r._count._all })),
    });
  }
  return reports;
}

async function flagCounts(): Promise<TimeMigrationReport["flags"]> {
  const rows = await prisma.dataQualityFlag.groupBy({
    by: ["kind", "status"],
    where: { kind: { in: [...TIME_FLAG_KINDS] } },
    _count: { _all: true },
  });
  const byStatus = (status: string): number =>
    rows.filter((r) => r.status === status).reduce((sum, r) => sum + r._count._all, 0);
  return {
    open: byStatus("open"),
    resolved: byStatus("resolved"),
    dismissed: byStatus("dismissed"),
    byKind: TIME_FLAG_KINDS.map((kind) => ({
      kind,
      open: rows
        .filter((r) => r.kind === kind && r.status === "open")
        .reduce((sum, r) => sum + r._count._all, 0),
    })),
  };
}

/** The inbox question per open row: `"<entityType> <rowId> <kind>"` → flag id. */
async function flagIds(
  rows: ReadonlyArray<{ entityType: string; rowId: string }>
): Promise<Map<string, string>> {
  if (rows.length === 0) return new Map();
  const flags = await prisma.dataQualityFlag.findMany({
    where: {
      kind: { in: [...TIME_FLAG_KINDS] },
      entityId: { in: [...new Set(rows.map((r) => r.rowId))] },
    },
    select: { id: true, entityType: true, entityId: true, kind: true },
  });
  return new Map(flags.map((f) => [`${f.entityType} ${f.entityId} ${f.kind}`, f.id]));
}

/** Where each open row is edited — admin-wide, so not scoped to an account. */
async function linksOf(
  rows: ReadonlyArray<{ table: TimeMigrationTable; rowId: string }>
): Promise<Map<string, RowLink>> {
  const links = new Map<string, RowLink>();
  for (const table of TIME_MIGRATION_TABLES) {
    const ids = [...new Set(rows.filter((r) => r.table === table).map((r) => r.rowId))];
    for (const [id, link] of await loadRowLinks(ENTITY_OF_TABLE[table], ids, null)) {
      links.set(`${table} ${id}`, link);
    }
  }
  return links;
}

async function openRows(): Promise<Pick<TimeMigrationReport, "openRows" | "openRowsTruncated">> {
  const ledger = await prisma.timeMigrationLedger.findMany({
    where: { status: "open" },
    orderBy: [{ tableName: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: OPEN_ROWS_CAP + 1,
  });
  const rows = ledger
    .slice(0, OPEN_ROWS_CAP)
    .filter((r) => isTable(r.tableName))
    .map((r) => {
      const table = r.tableName as TimeMigrationTable;
      return { ...r, table, entityType: ENTITY_OF_TABLE[table] };
    });
  const [links, flags] = await Promise.all([linksOf(rows), flagIds(rows)]);
  return {
    openRows: rows.map((r) => {
      const reason = isReason(r.reason) ? r.reason : null;
      const kind = reason ? kindOf(reason) : null;
      const link = links.get(`${r.table} ${r.rowId}`);
      return {
        table: r.table,
        rowId: r.rowId,
        userId: r.userId,
        column: r.columnName,
        rule: r.rule,
        reason,
        legacyValue: r.legacyValue,
        newValue: r.newValue,
        zone: r.zone,
        entityType: r.entityType,
        parentType: link?.parentType ?? null,
        parentId: link?.parentId ?? null,
        tripId: link?.tripId ?? null,
        flagId: kind ? (flags.get(`${r.entityType} ${r.rowId} ${kind}`) ?? null) : null,
        kind,
        label: link?.label ?? null,
      };
    }),
    openRowsTruncated: ledger.length > OPEN_ROWS_CAP,
  };
}

function backfillSummary(completedAt: Date | null): TimeMigrationReport["backfill"] {
  const run = backfillRunState();
  const state =
    run.state === "running"
      ? "running"
      : completedAt
        ? "completed"
        : run.state === "failed"
          ? "failed"
          : "pending";
  return {
    state,
    completedAt: completedAt ? completedAt.toISOString() : null,
    lastError: run.state === "failed" ? run.code : null,
    tzdata: process.versions.tz ?? null,
  };
}

export async function buildTimeMigrationReport(): Promise<TimeMigrationReport> {
  // Settle every account first: a question answered since the last inbox pass
  // must not still be counted open here (the owner's report "Offen" count).
  await settleTimeLedger(null);
  const settings = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { timeModelBackfillAt: true },
  });
  const [tables, flags, rows] = await Promise.all([tableReports(), flagCounts(), openRows()]);
  return {
    backfill: backfillSummary(settings?.timeModelBackfillAt ?? null),
    tables,
    unchanged: [
      { domain: "tours", why: "already_dates" },
      { domain: "track_windows", why: "already_instants" },
      { domain: "photos", why: "already_instants" },
      { domain: "loyalty", why: "no_time_columns" },
      { domain: "country_days", why: "utc_by_decision" },
    ],
    flags,
    ...rows,
  };
}
