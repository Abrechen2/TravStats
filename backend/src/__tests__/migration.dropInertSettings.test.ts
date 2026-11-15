import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261115165911 drops the three inert user_settings columns and
 * strips the three inert keys from the settings JSON (forgejo#389). Replayed
 * against a scratch schema holding rows in the OLD shape: the dead JSON keys
 * go, every neighbouring key survives, the live auto-update columns keep their
 * values, and a second run changes nothing.
 */
const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20261115165911_drop_inert_settings/migration.sql"
);
const SCHEMA = "migtest_inert_settings";

function statements(): string[] {
  return fs
    .readFileSync(MIGRATION, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const ROWS: Array<[string, object]> = [
  [
    "old",
    {
      map: { mapStyle: "satellite", zoomLevel: 7, markerStyle: "circle", routeColor: "#fff" },
      notifications: { emailNotifications: false, flightReminder: "48h" },
    },
  ],
  ["partial", { map: { zoomLevel: 3 } }],
  ["clean", { map: { mapStyle: "osm" }, notifications: { flightReminder: "24h" } }],
  ["nomap", { display: { a: 1 } }],
];

describe("migration 20261115165911 — inert settings are dropped", () => {
  let first: Record<string, { data: unknown; expiry: number }>;
  let second: Record<string, { data: unknown; expiry: number }>;
  let columns: string[];

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    const read = async (tx: Pick<typeof prisma, "$queryRawUnsafe">) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ id: string; data: unknown; auto_update_expiry_hours: number }>
      >(`SELECT id, data, auto_update_expiry_hours FROM user_settings ORDER BY id`);
      return Object.fromEntries(
        rows.map((r) => [r.id, { data: r.data, expiry: r.auto_update_expiry_hours }])
      );
    };
    ({ first, second, columns } = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      await tx.$executeRawUnsafe(
        `CREATE TABLE user_settings (id TEXT PRIMARY KEY, data JSONB NOT NULL,
           auto_update_check_interval INT NOT NULL DEFAULT 15,
           auto_update_only_during_flight BOOLEAN NOT NULL DEFAULT true,
           boarding_pass_parser_strategy TEXT,
           auto_update_expiry_hours INT NOT NULL DEFAULT 24)`
      );
      for (const [id, data] of ROWS) {
        await tx.$executeRawUnsafe(
          `INSERT INTO user_settings (id, data, auto_update_expiry_hours) VALUES ($1, $2::jsonb, 48)`,
          id,
          JSON.stringify(data)
        );
      }
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);
      const first = await read(tx);
      const cols = await tx.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = '${SCHEMA}' AND table_name = 'user_settings'`
      );
      // Idempotent on the JSON part (the column drops are one-shot by nature).
      const jsonOnly = statements().filter((s) => s.startsWith("UPDATE"));
      for (const sql of jsonOnly) await tx.$executeRawUnsafe(sql);
      return { first, second: await read(tx), columns: cols.map((c) => c.column_name) };
    }));
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  });

  it("strips the three dead keys and keeps their neighbours", () => {
    expect(first.old.data).toEqual({
      map: { mapStyle: "satellite", routeColor: "#fff" },
      notifications: { flightReminder: "48h" },
    });
    expect(first.partial.data).toEqual({ map: {} });
  });

  it("leaves rows without the keys untouched", () => {
    expect(first.clean.data).toEqual({
      map: { mapStyle: "osm" },
      notifications: { flightReminder: "24h" },
    });
    expect(first.nomap.data).toEqual({ display: { a: 1 } });
  });

  it("drops the three columns and keeps the live auto-update ones with their values", () => {
    expect(columns).not.toContain("auto_update_check_interval");
    expect(columns).not.toContain("auto_update_only_during_flight");
    expect(columns).not.toContain("boarding_pass_parser_strategy");
    expect(first.old.expiry).toBe(48);
  });

  it("is idempotent on the settings JSON", () => {
    expect(second).toEqual(first);
  });
});
