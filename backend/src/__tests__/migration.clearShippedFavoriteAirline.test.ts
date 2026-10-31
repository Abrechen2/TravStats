import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261031130000 removes the shipped "Lufthansa" from
 * user_settings.data.defaults.favoriteAirline (forgejo#389) once the setting
 * started to prefill flights. Replayed against a scratch schema holding rows
 * in the old shape: "Lufthansa" is cleared, any other airline is kept, a row
 * without the key is untouched, and a second run changes nothing.
 */
const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20261031130000_clear_shipped_favorite_airline/migration.sql"
);
const SCHEMA = "migtest_favorite_airline";

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

const ROWS: Array<[string, object]> = [
  ["lh", { defaults: { favoriteAirline: "Lufthansa", seatClass: "economy" }, display: { a: 1 } }],
  ["condor", { defaults: { favoriteAirline: "Condor" } }],
  ["lhx", { defaults: { favoriteAirline: "Lufthansa Cargo" } }],
  ["nokey", { defaults: { seatClass: "first" } }],
  ["nodefaults", { display: { a: 1 } }],
];

describe("migration 20261031130000 — shipped favourite airline is cleared", () => {
  let first: Record<string, unknown>;
  let second: Record<string, unknown>;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    const read = async (tx: Pick<typeof prisma, "$queryRawUnsafe">) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; data: unknown }>>(
        `SELECT id, data FROM user_settings ORDER BY id`
      );
      return Object.fromEntries(rows.map((r) => [r.id, r.data]));
    };
    ({ first, second } = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      await tx.$executeRawUnsafe(
        `CREATE TABLE user_settings (id TEXT PRIMARY KEY, data JSONB NOT NULL)`
      );
      for (const [id, data] of ROWS) {
        await tx.$executeRawUnsafe(
          `INSERT INTO user_settings (id, data) VALUES ($1, $2::jsonb)`,
          id,
          JSON.stringify(data)
        );
      }
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);
      const first = await read(tx);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);
      return { first, second: await read(tx) };
    }));
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  });

  it("clears an exact 'Lufthansa' and keeps the rest of the group", () => {
    expect(first.lh).toEqual({ defaults: { seatClass: "economy" }, display: { a: 1 } });
  });

  it("keeps any other airline, including one that merely starts with Lufthansa", () => {
    expect(first.condor).toEqual({ defaults: { favoriteAirline: "Condor" } });
    expect(first.lhx).toEqual({ defaults: { favoriteAirline: "Lufthansa Cargo" } });
  });

  it("leaves rows without the key untouched", () => {
    expect(first.nokey).toEqual({ defaults: { seatClass: "first" } });
    expect(first.nodefaults).toEqual({ display: { a: 1 } });
  });

  it("is idempotent", () => {
    expect(second).toEqual(first);
  });
});
