import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261020170000 adds `user_settings.settings_level` (forgejo#321)
 * with a hand-edited backfill: every account that existed before it becomes
 * `expert`, so the settings redesign hides nothing anyone was already using,
 * while a row created afterwards starts at `standard`. A plain
 * `ADD COLUMN ... DEFAULT 'standard'` would have quietly put every existing
 * account on the reduced page.
 *
 * Replayed against a scratch schema holding the old shape with rows in it, as
 * in `migration.loyaltyMemberships.test.ts`.
 */

const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20261020170000_user_settings_level/migration.sql"
);
const SCHEMA = "migtest_settings_level";

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

/** The columns of `user_settings` this migration touches or needs, in the old shape. */
const PRE_MIGRATION = [
  `CREATE TABLE user_settings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, data JSONB NOT NULL)`,
  `INSERT INTO user_settings (id, user_id, data) VALUES ('s1', 'u1', '{}'), ('s2', 'u2', '{}')`,
];

type Row = { user_id: string; settings_level: string };

describe("migration 20261020170000 — settings level", () => {
  let rows: Row[];

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);
      await tx.$executeRawUnsafe(
        `INSERT INTO user_settings (id, user_id, data) VALUES ('s3', 'u3', '{}')`
      );
      return tx.$queryRawUnsafe<Row[]>(
        `SELECT user_id, settings_level FROM user_settings ORDER BY user_id`
      );
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it("puts every existing account on expert", () => {
    expect(rows.filter((r) => r.user_id !== "u3")).toEqual([
      { user_id: "u1", settings_level: "expert" },
      { user_id: "u2", settings_level: "expert" },
    ]);
  });

  it("starts a row created afterwards at standard", () => {
    expect(rows.find((r) => r.user_id === "u3")).toEqual({
      user_id: "u3",
      settings_level: "standard",
    });
  });
});
