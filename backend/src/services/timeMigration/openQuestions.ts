import { prisma } from "../../db";
import type {
  DataQualityFlagKind,
  TimeFlagEntityType,
  TimeQuestionDetails,
} from "../../schemas/dataQualityFlag";
import {
  ENTITY_OF_TABLE,
  TIME_MIGRATION_REASONS,
  TIME_MIGRATION_TABLES,
  type TimeMigrationReason,
  type TimeMigrationTable,
} from "../../schemas/timeMigration";

/**
 * The backfill's open ledger rows as inbox questions (ADR 0002 phase 3b) —
 * but only while the question still stands.
 *
 * The data-quality runner reconciles: a flag its checks do not reproduce is
 * resolved. So the backfill's questions are not written once and left; they
 * are a CHECK, re-evaluated every run against the row as it is now:
 *
 * - a missing zone is answered once the row has a zone (the user added the
 *   airport's position, resolved the port);
 * - an unknown time of day is answered once the precision is no longer
 *   `unknown` (the user set the time);
 * - an uncertain day is answered once the stored day was changed — or by
 *   "dismiss" (this day is right), which the runner never re-opens.
 *
 * A deleted row answers every question about it.
 */

export type TimeFlagKind = Extract<DataQualityFlagKind, `time_${string}`>;

export interface TimeQuestion {
  entityType: TimeFlagEntityType;
  entityId: string;
  kind: TimeFlagKind;
  details: TimeQuestionDetails;
}

export function kindOf(reason: TimeMigrationReason): TimeFlagKind {
  switch (reason) {
    case "no_position":
    case "zone_unresolved":
    case "port_unresolved":
      return "time_zone_unresolved";
    case "date_only_day_differs":
    case "day_anchor_ambiguous":
      return "time_day_ambiguous";
    default:
      return "time_precision_unknown";
  }
}

/** Where, in the row as it is now, each ledger column's answer can be read. */
interface FieldSpec {
  zone?: string;
  precision?: string;
  /** The legacy value; a changed one answers a day question. */
  legacy?: string;
  /** The converted instant; a filled one answers a gap question (a stay's time). */
  instant?: string;
}

const SPECS: Record<TimeMigrationTable, Record<string, FieldSpec>> = {
  flights: {
    departure: { zone: "depTimezone", precision: "depPrecision", legacy: "departureTime" },
    arrival: { zone: "arrTimezone", precision: "arrPrecision", legacy: "arrivalTime" },
  },
  rail_journeys: {
    departure: { zone: "depTimezone", precision: "depPrecision" },
    arrival: { zone: "arrTimezone", precision: "arrPrecision" },
  },
  place_visits: {
    visited_at: { zone: "visitedZone", precision: "visitedPrecision", legacy: "visitedAt" },
  },
  cruise_stops: {
    arrival_time: { zone: "stopZone", precision: "timePrecision" },
    departure_time: { zone: "stopZone", precision: "timePrecision" },
    date: { legacy: "date" },
  },
  cruises: { start_date: { legacy: "startDate" }, end_date: { legacy: "endDate" } },
  trip_stops: {
    start_date: { zone: "stopZone", precision: "precision", legacy: "startDate" },
    end_date: { zone: "stopZone", precision: "precision", legacy: "endDate" },
  },
  trips: {
    start_date: { zone: "startZone", legacy: "startDate" },
    end_date: { zone: "endZone", legacy: "endDate" },
  },
  trip_journal_entries: { date: { legacy: "date" } },
  lodging_stays: {
    check_in: { legacy: "checkIn" },
    check_out: { legacy: "checkOut" },
    check_in_time: { zone: "stayZone", instant: "checkInAt" },
    check_out_time: { zone: "stayZone", instant: "checkOutAt" },
  },
  users: { birthdate: { legacy: "birthdate" } },
};

type Current = Record<string, unknown>;

const text = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;

/** Whether a question the backfill asked is still unanswered in `current`. */
export function stillOpen(
  spec: FieldSpec | undefined,
  reason: TimeMigrationReason,
  legacyValue: string | null,
  current: Current
): boolean {
  if (!spec) return true;
  switch (kindOf(reason)) {
    case "time_zone_unresolved":
      return spec.zone ? current[spec.zone] == null : true;
    case "time_day_ambiguous":
      return spec.legacy ? text(current[spec.legacy]) === legacyValue : true;
    default:
      if (spec.instant) return current[spec.instant] == null;
      if (spec.precision) return current[spec.precision] === "unknown";
      return spec.legacy ? text(current[spec.legacy]) === legacyValue : true;
  }
}

/** `userId` null: every account's rows (the admin report settles them all). */
type Owner = string | null;
const own = (userId: Owner) => (userId ? { userId } : {});

const SELECTS: Record<TimeMigrationTable, (ids: string[], userId: Owner) => Promise<Current[]>> = {
  flights: (ids, userId) =>
    prisma.flight.findMany({
      where: { id: { in: ids }, ...own(userId) },
      select: {
        id: true,
        depTimezone: true,
        arrTimezone: true,
        depPrecision: true,
        arrPrecision: true,
        departureTime: true,
        arrivalTime: true,
      },
    }),
  rail_journeys: (ids, userId) =>
    prisma.railJourney.findMany({
      where: { id: { in: ids }, ...own(userId) },
      select: {
        id: true,
        depTimezone: true,
        arrTimezone: true,
        depPrecision: true,
        arrPrecision: true,
      },
    }),
  place_visits: (ids, userId) =>
    prisma.placeVisit.findMany({
      where: { id: { in: ids }, ...own(userId) },
      select: { id: true, visitedZone: true, visitedPrecision: true, visitedAt: true },
    }),
  cruise_stops: (ids, userId) =>
    prisma.cruiseStop.findMany({
      where: { id: { in: ids }, ...(userId && { cruise: { userId } }) },
      select: { id: true, stopZone: true, timePrecision: true, date: true },
    }),
  cruises: (ids, userId) =>
    prisma.cruise.findMany({
      where: { id: { in: ids }, ...own(userId) },
      select: { id: true, startDate: true, endDate: true },
    }),
  trip_stops: (ids, userId) =>
    prisma.tripStop.findMany({
      where: {
        id: { in: ids },
        ...(userId && { OR: [{ trip: { userId } }, { route: { userId } }] }),
      },
      select: { id: true, stopZone: true, precision: true, startDate: true, endDate: true },
    }),
  trips: (ids, userId) =>
    prisma.trip.findMany({
      where: { id: { in: ids }, ...own(userId) },
      select: { id: true, startZone: true, endZone: true, startDate: true, endDate: true },
    }),
  trip_journal_entries: (ids, userId) =>
    prisma.tripJournalEntry.findMany({
      where: { id: { in: ids }, ...(userId && { trip: { userId } }) },
      select: { id: true, date: true },
    }),
  lodging_stays: (ids, userId) =>
    prisma.lodgingStay.findMany({
      where: { id: { in: ids }, ...own(userId) },
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        stayZone: true,
        checkInAt: true,
        checkOutAt: true,
      },
    }),
  users: (ids, userId) =>
    prisma.user.findMany({
      where: { id: { in: userId ? ids.filter((id) => id === userId) : ids } },
      select: { id: true, birthdate: true },
    }),
};

const isReason = (value: string | null): value is TimeMigrationReason =>
  value !== null && (TIME_MIGRATION_REASONS as readonly string[]).includes(value);

const isTable = (value: string): value is TimeMigrationTable =>
  (TIME_MIGRATION_TABLES as readonly string[]).includes(value);

/** One account's time questions that still stand, in a stable order. */
export async function loadOpenTimeQuestions(userId: string): Promise<TimeQuestion[]> {
  // Every inbox pass settles what was answered since the last one, so the
  // ledger — and the admin report read from it — follows the user's answers.
  await settleTimeLedger(userId);
  const ledger = await prisma.timeMigrationLedger.findMany({
    where: { userId, status: "open", reason: { not: null } },
    orderBy: [{ tableName: "asc" }, { rowId: "asc" }, { columnName: "asc" }, { id: "asc" }],
  });
  const questions = new Map<string, TimeQuestion>();
  for (const table of TIME_MIGRATION_TABLES) {
    const rows = ledger.filter((l) => l.tableName === table);
    if (rows.length === 0) continue;
    const current = new Map(
      (await SELECTS[table]([...new Set(rows.map((r) => r.rowId))], userId)).map((c) => [
        c.id as string,
        c,
      ])
    );
    for (const l of rows) {
      const row = current.get(l.rowId);
      const reason = l.reason as TimeMigrationReason;
      if (!row || !isTable(l.tableName)) continue;
      if (!stillOpen(SPECS[table][l.columnName], reason, l.legacyValue, row)) continue;
      const kind = kindOf(reason);
      const key = `${table} ${l.rowId} ${kind}`;
      const question = questions.get(key) ?? {
        entityType: ENTITY_OF_TABLE[table],
        entityId: l.rowId,
        kind,
        details: { table, fields: [] },
      };
      question.details.fields.push({
        column: l.columnName,
        reason,
        legacyValue: l.legacyValue,
        keptValue: l.newValue,
        zone: l.zone,
      });
      questions.set(key, question);
    }
  }
  return [...questions.values()];
}

/**
 * Marks every open ledger row whose question no longer stands `resolved`
 * (ADR 0002 phase 4) — one rule, the one above (`stillOpen`), so the ledger,
 * the inbox and the admin report cannot disagree about what is still open:
 *
 * - the row got its answer through any write path (a zone, a time of day, a
 *   changed day), or
 * - the row is gone, or
 * - the owner dismissed the inbox question ("this day is right"), which the
 *   data-quality runner never re-opens.
 *
 * Before this, the ledger stayed `open` for ever once the user had answered,
 * and the report's "open" count never dropped. `userId` null settles every
 * account (the admin report); a user's inbox pass settles only theirs.
 */
export async function settleTimeLedger(userId: string | null): Promise<number> {
  const ledger = await prisma.timeMigrationLedger.findMany({
    where: { status: "open", reason: { not: null }, ...(userId && { userId }) },
    select: {
      id: true,
      tableName: true,
      rowId: true,
      columnName: true,
      reason: true,
      legacyValue: true,
    },
  });
  if (ledger.length === 0) return 0;
  const dismissed = new Set(
    (
      await prisma.dataQualityFlag.findMany({
        where: {
          status: "dismissed",
          kind: { in: ["time_zone_unresolved", "time_precision_unknown", "time_day_ambiguous"] },
          entityId: { in: [...new Set(ledger.map((l) => l.rowId))] },
          ...(userId && { userId }),
        },
        select: { entityType: true, entityId: true, kind: true },
      })
    ).map((f) => `${f.entityType} ${f.entityId} ${f.kind}`)
  );
  const answered: string[] = [];
  for (const table of TIME_MIGRATION_TABLES) {
    // A reason this server does not know is not judged: it stays open.
    const rows = ledger.filter((l) => l.tableName === table && isReason(l.reason));
    if (rows.length === 0) continue;
    const current = new Map(
      (await SELECTS[table]([...new Set(rows.map((r) => r.rowId))], userId)).map((c) => [
        c.id as string,
        c,
      ])
    );
    for (const l of rows) {
      const reason = l.reason as TimeMigrationReason;
      const row = current.get(l.rowId);
      const flagKey = `${ENTITY_OF_TABLE[table]} ${l.rowId} ${kindOf(reason)}`;
      if (
        !row ||
        dismissed.has(flagKey) ||
        !stillOpen(SPECS[table][l.columnName], reason, l.legacyValue, row)
      ) {
        answered.push(l.id);
      }
    }
  }
  if (answered.length === 0) return 0;
  const { count } = await prisma.timeMigrationLedger.updateMany({
    where: { id: { in: answered }, status: "open" },
    data: { status: "resolved" },
  });
  return count;
}
