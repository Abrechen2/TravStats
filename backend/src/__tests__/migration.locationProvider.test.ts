import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261024171325 adds the per-user location provider and backfills
 * it (TravTrack plan, task S2, review focus 1): whoever has their OWN Dawarich
 * connection — base URL AND key — today becomes provider `dawarich`, so every
 * automatic Dawarich feature keeps running for exactly the users it ran for.
 * Everyone else, including a half-configured connection, becomes `none`.
 *
 * Replayed against a SCRATCH schema holding the pre-migration shape, the way
 * `migration.loyaltyMemberships.test.ts` does it.
 */

const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20261024171325_location_provider/migration.sql"
);
const SCHEMA = "migtest_location_provider";

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

/** The columns the migration reads, as `user_settings` had them before it. */
const PRE_MIGRATION = [
  `CREATE TABLE user_settings (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE,
     dawarich_base_url TEXT, dawarich_api_key TEXT)`,
  `INSERT INTO user_settings (id, user_id, dawarich_base_url, dawarich_api_key) VALUES
     ('s1', 'own-connection', 'http://dawarich.local:3000', 'enc:key'),
     ('s2', 'url-only', 'http://dawarich.local:3000', NULL),
     ('s3', 'nothing', NULL, NULL)`,
];

type Row = { user_id: string; location_provider: string; location_provider_rev: number };

describe("migration 20261024171325 — the location provider", () => {
  let rows: Row[];
  let checkRejects: boolean;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    ({ rows, checkRejects } = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);

      const after = await tx.$queryRawUnsafe<Row[]>(
        `SELECT user_id, location_provider, location_provider_rev FROM user_settings ORDER BY id`
      );
      await tx.$executeRawUnsafe(`SAVEPOINT probe`);
      let rejected = false;
      try {
        await tx.$executeRawUnsafe(
          `UPDATE user_settings SET location_provider = 'owntracks' WHERE id = 's3'`
        );
      } catch {
        rejected = true;
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT probe`);
      return { rows: after, checkRejects: rejected };
    }));
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it("makes an own Dawarich connection provider dawarich, a URL alone and nothing none", () => {
    expect(rows).toEqual([
      { user_id: "own-connection", location_provider: "dawarich", location_provider_rev: 0 },
      { user_id: "url-only", location_provider: "none", location_provider_rev: 0 },
      { user_id: "nothing", location_provider: "none", location_provider_rev: 0 },
    ]);
  });

  it("holds the three values with a CHECK constraint", () => {
    expect(checkRejects).toBe(true);
  });
});
