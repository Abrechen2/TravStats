import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20260927014000_time_model_backfill_marker (ADR 0002 phase 3b) was
 * written by hand, together with its `rollback.sql` and `undo-backfill.sql`.
 * CLAUDE.md admits a hand-written migration only with a replay test beside it
 * and `check:drift` green; this is the replay test.
 *
 * The promise all three files make is "additive and lossless": the migration
 * adds a marker and two ledger columns and touches no existing row; the
 * rollback drops exactly those and keeps every row; the data undo clears only
 * the rows the ledger names and leaves the ledger, the legacy columns and every
 * row a write path filled on its own.
 *
 * The migration and the rollback are replayed against a SCRATCH schema in the
 * shape `20260926224058_time_model_columns` left (statements are unqualified,
 * so `search_path` aims them there). The data undo needs the real tables, so it
 * runs in the test database inside a transaction that is always rolled back.
 */

const DIR = path.join(
  __dirname,
  "../../prisma/migrations/20260927014000_time_model_backfill_marker"
);
const SCHEMA = "migtest_time_marker";

/** The file's statements, comments and blank lines dropped. */
function statements(file: string): string[] {
  return fs
    .readFileSync(path.join(DIR, file), "utf-8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The two tables the migration alters, as the phase-3a migration left them, with rows. */
const PRE_MIGRATION = [
  `CREATE TABLE admin_settings (id TEXT PRIMARY KEY, public_url TEXT)`,
  `CREATE TABLE time_migration_ledger (
     id TEXT NOT NULL, table_name TEXT NOT NULL, row_id TEXT NOT NULL,
     column_name TEXT NOT NULL, legacy_value TEXT, new_value TEXT, zone TEXT,
     rule TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
     created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT time_migration_ledger_pkey PRIMARY KEY (id))`,
  `CREATE INDEX time_migration_ledger_status_idx ON time_migration_ledger(status)`,
  `INSERT INTO admin_settings (id, public_url) VALUES ('singleton', 'https://example.test')`,
  `INSERT INTO time_migration_ledger (id, table_name, row_id, column_name, legacy_value, new_value, zone, rule, status)
     VALUES ('l1', 'flights', 'f1', 'departure', '2019-06-01T10:00:00.000Z', '2019-06-01T01:00:00.000Z',
             'Asia/Tokyo', 'flight.fake_utc', 'resolved'),
            ('l2', 'place_visits', 'v1', 'visited_at', '2026-09-13T16:00:00.000Z', NULL,
             'Europe/Rome', 'visit.writer_unknown', 'open')`,
];

type Row = Record<string, unknown>;

async function columnsOf(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  table: string
): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = '${SCHEMA}' AND table_name = '${table}' ORDER BY column_name`
  );
  return rows.map((r) => r.column_name);
}

describe("migration 20260927014000 — the backfill marker and the ledger's reason/owner", () => {
  let migrated: {
    settings: Row[];
    ledger: Row[];
    settingsColumns: string[];
    ledgerColumns: string[];
    indexes: string[];
  };
  let rolledBack: {
    settings: Row[];
    ledger: Row[];
    settingsColumns: string[];
    ledgerColumns: string[];
  };

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements("migration.sql")) await tx.$executeRawUnsafe(sql);

      migrated = {
        settings: await tx.$queryRawUnsafe<Row[]>(
          `SELECT id, public_url, time_model_backfill_at FROM admin_settings`
        ),
        ledger: await tx.$queryRawUnsafe<Row[]>(
          `SELECT id, row_id, status, zone, reason, user_id FROM time_migration_ledger ORDER BY id`
        ),
        settingsColumns: await columnsOf(tx, "admin_settings"),
        ledgerColumns: await columnsOf(tx, "time_migration_ledger"),
        indexes: (
          await tx.$queryRawUnsafe<Array<{ indexname: string }>>(
            `SELECT indexname FROM pg_indexes WHERE schemaname = '${SCHEMA}' ORDER BY indexname`
          )
        ).map((r) => r.indexname),
      };

      // What the backfill writes into the new columns, before rolling back.
      await tx.$executeRawUnsafe(
        `UPDATE admin_settings SET time_model_backfill_at = '2026-09-27T08:00:00.000'`
      );
      await tx.$executeRawUnsafe(
        `UPDATE time_migration_ledger SET reason = 'writer_unknown', user_id = 'u1' WHERE id = 'l2'`
      );
      for (const sql of statements("rollback.sql")) await tx.$executeRawUnsafe(sql);

      rolledBack = {
        settings: await tx.$queryRawUnsafe<Row[]>(`SELECT id, public_url FROM admin_settings`),
        ledger: await tx.$queryRawUnsafe<Row[]>(
          `SELECT id, row_id, status, zone FROM time_migration_ledger ORDER BY id`
        ),
        settingsColumns: await columnsOf(tx, "admin_settings"),
        ledgerColumns: await columnsOf(tx, "time_migration_ledger"),
      };
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  });

  it("adds the marker and the two ledger columns, empty, and keeps every existing row", () => {
    expect(migrated.settings).toEqual([
      { id: "singleton", public_url: "https://example.test", time_model_backfill_at: null },
    ]);
    expect(migrated.ledger).toEqual([
      {
        id: "l1",
        row_id: "f1",
        status: "resolved",
        zone: "Asia/Tokyo",
        reason: null,
        user_id: null,
      },
      { id: "l2", row_id: "v1", status: "open", zone: "Europe/Rome", reason: null, user_id: null },
    ]);
    expect(migrated.settingsColumns).toContain("time_model_backfill_at");
    expect(migrated.ledgerColumns).toEqual(expect.arrayContaining(["reason", "user_id"]));
    expect(migrated.indexes).toContain("time_migration_ledger_user_id_status_idx");
  });

  it("rolls back to exactly the old columns, and keeps every row it had", () => {
    expect(rolledBack.settingsColumns).toEqual(["id", "public_url"]);
    expect(rolledBack.ledgerColumns).not.toEqual(expect.arrayContaining(["reason"]));
    expect(rolledBack.ledgerColumns).not.toContain("user_id");
    expect(rolledBack.settings).toEqual([{ id: "singleton", public_url: "https://example.test" }]);
    expect(rolledBack.ledger).toEqual([
      { id: "l1", row_id: "f1", status: "resolved", zone: "Asia/Tokyo" },
      { id: "l2", row_id: "v1", status: "open", zone: "Europe/Rome" },
    ]);
  });
});

describe("undo-backfill.sql — clears what the backfill wrote, and nothing else", () => {
  /** Thrown to roll the probe transaction back after reading its result. */
  class Rollback extends Error {
    constructor(readonly rows: Row[]) {
      super("rollback");
    }
  }

  it("empties the new columns of ledger rows only; legacy columns, ledger and other rows stay", async () => {
    let rows: Row[] = [];
    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { username: `undo-probe-${Date.now()}`, passwordHash: "x" },
        });
        const legacy = new Date("2019-06-01T10:00:00.000Z");
        const backfilled = await tx.flight.create({
          data: {
            userId: user.id,
            depLat: 0,
            depLon: 0,
            arrLat: 0,
            arrLon: 0,
            departureTime: legacy,
            depTimeSemantics: "LEGACY_FAKE_UTC",
            depTimezone: "Asia/Tokyo",
            depPrecision: "minute",
          },
        });
        // Filled by a phase-2 write path: no ledger row, so not the backfill's.
        const written = await tx.flight.create({
          data: {
            userId: user.id,
            depLat: 0,
            depLon: 0,
            arrLat: 0,
            arrLon: 0,
            departureTime: legacy,
            depTimezone: "Europe/Berlin",
            depPrecision: "minute",
          },
        });
        await tx.timeMigrationLedger.create({
          data: {
            tableName: "flights",
            rowId: backfilled.id,
            columnName: "departure",
            rule: "flight.fake_utc",
            status: "resolved",
            userId: user.id,
          },
        });

        for (const sql of statements("undo-backfill.sql")) await tx.$executeRawUnsafe(sql);

        throw new Rollback(
          await tx.$queryRawUnsafe<Row[]>(
            `SELECT f.id, f.departure_time, f.dep_time_semantics, f.dep_timezone, f.dep_precision,
                    (SELECT count(*)::int FROM time_migration_ledger l WHERE l.row_id = f.id) AS ledger
               FROM flights f WHERE f.id IN ('${backfilled.id}', '${written.id}')
              ORDER BY f.dep_timezone NULLS FIRST`
          )
        );
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
      rows = err.rows;
    }

    expect(rows).toEqual([
      {
        id: expect.any(String),
        departure_time: new Date("2019-06-01T10:00:00.000Z"),
        dep_time_semantics: "LEGACY_FAKE_UTC",
        dep_timezone: null,
        dep_precision: null,
        ledger: 1,
      },
      {
        id: expect.any(String),
        departure_time: new Date("2019-06-01T10:00:00.000Z"),
        dep_time_semantics: "UTC",
        dep_timezone: "Europe/Berlin",
        dep_precision: "minute",
        ledger: 0,
      },
    ]);
  });
});
