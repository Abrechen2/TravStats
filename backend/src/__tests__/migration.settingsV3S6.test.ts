import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261111200000 (settings v3 S6) drops the five granular outbound
 * switches. An admin who had switched ALL of them off wanted an install that
 * talks to nobody, so the master switch `internet_enabled` takes that over; any
 * other combination cannot be one switch and keeps the default (on).
 *
 * The file is replayed against a SCRATCH schema holding the old shape with rows.
 */

const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20261111200000_settings_v3_s6_removals/migration.sql"
);
const SCHEMA = "migtest_settings_v3_s6";

function statements(): string[] {
  return fs
    .readFileSync(MIGRATION, "utf-8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const SWITCHES = [
  "fx_cdn_fallback_enabled",
  "operator_logos_open_data_enabled",
  "rail_transitous_enabled",
  "rail_db_rest_enabled",
  "update_check_enabled",
];

const row = (id: number, values: boolean[]): string =>
  `INSERT INTO admin_settings (id, internet_enabled, ${SWITCHES.join(", ")}, backup_enabled,
     log_http_requests, log_database_queries, log_parser_operations, max_log_file_size, max_log_files)
   VALUES (${id}, true, ${values.join(", ")}, false, false, false, false, 10, 7)`;

describe("migration 20261111200000 — the outbound switches fold into the internet switch", () => {
  let after: { id: number; internet_enabled: boolean }[];
  let columns: string[];

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    ({ after, columns } = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      await tx.$executeRawUnsafe(
        `CREATE TABLE admin_settings (id INTEGER PRIMARY KEY, internet_enabled BOOLEAN NOT NULL DEFAULT true,
           ${SWITCHES.map((c) => `${c} BOOLEAN NOT NULL DEFAULT true`).join(", ")},
           backup_enabled BOOLEAN NOT NULL DEFAULT false, log_http_requests BOOLEAN NOT NULL DEFAULT false,
           log_database_queries BOOLEAN NOT NULL DEFAULT false, log_parser_operations BOOLEAN NOT NULL DEFAULT false,
           max_log_file_size INTEGER NOT NULL DEFAULT 10, max_log_files INTEGER NOT NULL DEFAULT 7,
           keep_me TEXT DEFAULT 'kept')`
      );
      await tx.$executeRawUnsafe(row(1, [false, false, false, false, false])); // all off
      await tx.$executeRawUnsafe(row(2, [false, true, false, false, false])); // one still on
      await tx.$executeRawUnsafe(row(3, [true, true, true, true, true])); // defaults
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);
      const rows = await tx.$queryRawUnsafe<{ id: number; internet_enabled: boolean }[]>(
        `SELECT id, internet_enabled FROM admin_settings ORDER BY id`
      );
      const cols = await tx.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = '${SCHEMA}' AND table_name = 'admin_settings'`
      );
      return { after: rows, columns: cols.map((c) => c.column_name) };
    }));
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it("an install with every outbound switch off becomes an install with the internet switch off", () => {
    expect(after.find((r) => r.id === 1)?.internet_enabled).toBe(false);
  });

  it("a partly switched set keeps the master switch on, and so do the defaults", () => {
    expect(after.find((r) => r.id === 2)?.internet_enabled).toBe(true);
    expect(after.find((r) => r.id === 3)?.internet_enabled).toBe(true);
  });

  it("drops the eleven columns and leaves the rest of the table alone", () => {
    for (const gone of [
      ...SWITCHES,
      "backup_enabled",
      "log_http_requests",
      "log_database_queries",
      "log_parser_operations",
      "max_log_file_size",
      "max_log_files",
    ]) {
      expect(columns).not.toContain(gone);
    }
    expect(columns).toEqual(expect.arrayContaining(["id", "internet_enabled", "keep_me"]));
  });
});
