import fs from "fs";
import path from "path";

import { prisma } from "../db";
import { defaultSettings } from "../routes/settings/types";

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

const MIGRATIONS = [
  "20261020170000_user_settings_level",
  // An account that never opened the app since settings rows existed has no
  // row; the first GET would create one at `standard`. This one gives every
  // such account its row now, at `expert` — it existed before the redesign.
  "20261020171000_settings_rows_for_existing_users",
].map((dir) => path.join(__dirname, `../../prisma/migrations/${dir}/migration.sql`));
const SCHEMA = "migtest_settings_level";

function statements(file: string): string[] {
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The columns of `user_settings` this migration touches or needs, in the old shape. */
const PRE_MIGRATION = [
  `CREATE TABLE users (id TEXT PRIMARY KEY)`,
  `CREATE TABLE user_settings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id), data JSONB NOT NULL, updated_at TIMESTAMP(3) NOT NULL DEFAULT NOW())`,
  // u1 and u2 have a settings row; u4 is an existing account that has none.
  `INSERT INTO users (id) VALUES ('u1'), ('u2'), ('u4')`,
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
      for (const file of MIGRATIONS) {
        for (const sql of statements(file)) await tx.$executeRawUnsafe(sql);
      }
      // u3 signs up after the migration.
      await tx.$executeRawUnsafe(`INSERT INTO users (id) VALUES ('u3')`);
      await tx.$executeRawUnsafe(
        `INSERT INTO user_settings (id, user_id, data) VALUES ('s3', 'u3', '{}')`
      );
      return tx.$queryRawUnsafe<Row[]>(
        `SELECT user_id, settings_level FROM user_settings ORDER BY user_id`
      );
    });
  });

  it("gives an existing account without a row the blob the first GET would have stored", async () => {
    const [row] = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      return tx.$queryRawUnsafe<Array<{ data: unknown }>>(
        `SELECT data FROM user_settings WHERE user_id = 'u4'`
      );
    });
    // The migration froze the defaults of 2026-10-20, placeholder profile
    // included. Today's defaults carry no placeholder (F-002, 27.10.); the
    // settings route masks the frozen one on read instead of rewriting rows.
    const defaults = JSON.parse(JSON.stringify(defaultSettings));
    expect(row.data).toEqual({
      ...defaults,
      profile: { ...defaults.profile, username: "Traveler", email: "traveler@example.com" },
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
      { user_id: "u4", settings_level: "expert" },
    ]);
  });

  it("starts a row created afterwards at standard", () => {
    expect(rows.find((r) => r.user_id === "u3")).toEqual({
      user_id: "u3",
      settings_level: "standard",
    });
  });
});
