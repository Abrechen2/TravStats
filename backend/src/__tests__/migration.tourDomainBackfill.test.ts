import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261109130000: `tour` joined the domain registry, so every account
 * that already has a tour gets it enabled — creating the settings row where it
 * is missing (a missing row reads as "flights only" and would hide the tours).
 * Replayed against a scratch schema holding the OLD shape with rows in it, as
 * in `migration.userSettingsLevel.test.ts`.
 */
const FILE = path.join(
  __dirname,
  "../../prisma/migrations/20261109130000_tour_domain_backfill/migration.sql"
);
const SCHEMA = "migtest_tour_domain";

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

const PRE_MIGRATION = [
  `CREATE TABLE users (id TEXT PRIMARY KEY)`,
  `CREATE TABLE user_settings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id), enabled_domains TEXT[] NOT NULL DEFAULT ARRAY['flight'], data JSONB NOT NULL, updated_at TIMESTAMP(3) NOT NULL DEFAULT NOW())`,
  `CREATE TABLE trip_routes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL DEFAULT 'tour')`,
  `INSERT INTO users (id) VALUES ('hasRowTour'), ('noRowTour'), ('hasRowNoTour'), ('roadtripOnly'), ('alreadyTour'), ('noRowNoTour')`,
  `INSERT INTO user_settings (id, user_id, enabled_domains, data) VALUES
     ('s1', 'hasRowTour', ARRAY['flight','cruise'], '{}'),
     ('s3', 'hasRowNoTour', ARRAY['flight'], '{}'),
     ('s4', 'roadtripOnly', ARRAY['flight','roadtrip'], '{}'),
     ('s5', 'alreadyTour', ARRAY['flight','tour'], '{}')`,
  `INSERT INTO trip_routes (id, user_id, kind) VALUES
     ('r1', 'hasRowTour', 'tour'), ('r1b', 'hasRowTour', 'tour'),
     ('r2', 'noRowTour', 'tour'),
     ('r4', 'roadtripOnly', 'roadtrip'),
     ('r5', 'alreadyTour', 'tour')`,
];

type Row = { user_id: string; enabled_domains: string[]; data: unknown };

describe("migration 20261109130000 — tour domain backfill", () => {
  let rows: Row[];

  async function replay(tx: Pick<typeof prisma, "$executeRawUnsafe">): Promise<void> {
    for (const sql of statements(FILE)) await tx.$executeRawUnsafe(sql);
  }

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      await replay(tx);
      await replay(tx); // a second run must change nothing
      return tx.$queryRawUnsafe<Row[]>(
        `SELECT user_id, enabled_domains, data FROM user_settings ORDER BY user_id`
      );
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  const domains = (id: string): string[] | undefined =>
    rows.find((r) => r.user_id === id)?.enabled_domains;

  it("enables tour for an account with a settings row and a tour, keeping what it had", () => {
    expect(domains("hasRowTour")).toEqual(["flight", "cruise", "tour"]);
  });

  it("creates the missing settings row for an account that has tours, so they are not hidden", () => {
    expect(domains("noRowTour")).toEqual(["flight", "tour"]);
    expect(rows.find((r) => r.user_id === "noRowTour")?.data).toEqual({});
  });

  it("leaves accounts without a tour alone, and creates no row for them", () => {
    expect(domains("hasRowNoTour")).toEqual(["flight"]);
    expect(domains("roadtripOnly")).toEqual(["flight", "roadtrip"]);
    expect(domains("noRowNoTour")).toBeUndefined();
  });

  it("does not add tour twice", () => {
    expect(domains("alreadyTour")).toEqual(["flight", "tour"]);
    expect(domains("hasRowTour")?.filter((d) => d === "tour")).toHaveLength(1);
  });
});
