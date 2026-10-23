import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261023140047 adds `rail_journeys.transit_mode` and the rail
 * import's two account defaults. Its promise: every journey logged before it
 * is a train (`rail`) and keeps counting, every account starts by skipping
 * local-transit legs — what the import did before — and a row can say tram.
 * Replayed against a scratch schema holding the old shape with rows in it, as
 * in `migration.loyaltyMemberships.test.ts`.
 */

const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20261023140047_rail_transit_mode/migration.sql"
);
const SCHEMA = "migtest_rail_transit_mode";

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

/** The columns this migration touches or needs, in the old shape. */
const PRE_MIGRATION = [
  `CREATE TABLE rail_journeys (id TEXT PRIMARY KEY, status TEXT NOT NULL)`,
  `CREATE TABLE user_settings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE)`,
  `CREATE TABLE rail_stations (id SERIAL PRIMARY KEY, db_id TEXT)`,
  `INSERT INTO rail_journeys (id, status) VALUES ('r1', 'completed'), ('r2', 'scheduled')`,
  `INSERT INTO user_settings (id, user_id) VALUES ('s1', 'u1')`,
];

describe("migration 20261023140047 — rail transit mode", () => {
  let journeys: Array<{ id: string; transit_mode: string }>;
  let settings: Array<{ rail_import_local_transit: string; rail_import_bus: string }>;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    [journeys, settings] = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);
      await tx.$executeRawUnsafe(
        `INSERT INTO rail_journeys (id, status, transit_mode) VALUES ('r3', 'completed', 'tram')`
      );
      return Promise.all([
        tx.$queryRawUnsafe<Array<{ id: string; transit_mode: string }>>(
          `SELECT id, transit_mode FROM rail_journeys ORDER BY id`
        ),
        tx.$queryRawUnsafe<Array<{ rail_import_local_transit: string; rail_import_bus: string }>>(
          `SELECT rail_import_local_transit, rail_import_bus FROM user_settings`
        ),
      ]);
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it("makes every journey logged before it a train, and lets a new one be a tram", () => {
    expect(journeys).toEqual([
      { id: "r1", transit_mode: "rail" },
      { id: "r2", transit_mode: "rail" },
      { id: "r3", transit_mode: "tram" },
    ]);
  });

  it("starts every account by skipping local-transit legs, as the import did", () => {
    expect(settings).toEqual([{ rail_import_local_transit: "skip", rail_import_bus: "skip" }]);
  });
});
