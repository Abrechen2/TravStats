import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261027070421 adds the per-user TravPlan switch, off by default
 * like every domain but flights. Its promise: nobody who already plans loses
 * the planning area. Every account holding a plan comes out switched on —
 * including one that never had a settings row — and every other account off.
 *
 * Replayed against a scratch schema in the pre-migration shape, as the
 * loyalty-membership migration test does.
 */

const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20261027070421_travplan_per_user/migration.sql"
);
const SCHEMA = "migtest_travplan_user";

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

const PRE_MIGRATION = [
  `CREATE TABLE users (id TEXT PRIMARY KEY)`,
  `CREATE TABLE user_settings (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, data JSONB NOT NULL,
     enabled_domains TEXT[] NOT NULL DEFAULT ARRAY['flight']::TEXT[],
     updated_at TIMESTAMP(3) NOT NULL)`,
  `CREATE TABLE trips (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)`,
  `CREATE TABLE travel_plans (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL UNIQUE)`,
  // planner: row + two plans; app-only planner: plans, no row; idle: row, no plan.
  `INSERT INTO users (id) VALUES ('planner'), ('apponly'), ('idle'), ('norow')`,
  `INSERT INTO user_settings (id, user_id, data, enabled_domains, updated_at) VALUES
     ('s1', 'planner', '{"display":{"theme":"dark"}}', ARRAY['flight','lodging'], now()),
     ('s2', 'idle', '{}', ARRAY['flight'], now())`,
  `INSERT INTO trips (id, user_id) VALUES ('t1', 'planner'), ('t2', 'planner'),
     ('t3', 'apponly'), ('t4', 'apponly'), ('t5', 'idle')`,
  `INSERT INTO travel_plans (id, trip_id) VALUES ('p1', 't1'), ('p2', 't2'), ('p3', 't3'), ('p4', 't4')`,
];

type Row = {
  user_id: string;
  trav_plan_enabled: boolean;
  data: unknown;
  enabled_domains: string[];
};

describe("migration 20261027070421 — TravPlan becomes a per-user switch", () => {
  let rows: Row[];

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}, public`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);
      return tx.$queryRawUnsafe<Row[]>(
        `SELECT user_id, trav_plan_enabled, data, enabled_domains FROM user_settings ORDER BY user_id`
      );
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  const row = (userId: string) => rows.find((r) => r.user_id === userId);

  it("keeps TravPlan on for an account that holds a plan, and leaves its settings alone", () => {
    expect(row("planner")).toMatchObject({
      trav_plan_enabled: true,
      data: { display: { theme: "dark" } },
      enabled_domains: ["flight", "lodging"],
    });
  });

  it("gives a plan holder without a settings row one, switched on, holding one row", () => {
    expect(rows.filter((r) => r.user_id === "apponly")).toHaveLength(1);
    expect(row("apponly")).toMatchObject({ trav_plan_enabled: true, data: {} });
  });

  it("switches TravPlan off for an account without a plan, and creates no row for one", () => {
    expect(row("idle")?.trav_plan_enabled).toBe(false);
    expect(row("norow")).toBeUndefined();
  });
});
