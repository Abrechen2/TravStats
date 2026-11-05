import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261105182417 adds the `ratings` map next to the three category
 * columns and backfills it from them. The promise is "no verdict lost": every
 * existing room/breakfast/service value reappears under its key, a blank
 * stays absent (never 0), a stay with no rating keeps NULL, and the old
 * columns are untouched. Replayed against a scratch schema holding the old
 * shape with real rows.
 */
const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20261105182417_lodging_rating_categories/migration.sql"
);
const SCHEMA = "migtest_rating_categories";

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
  `CREATE TABLE user_settings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)`,
  `CREATE TABLE lodging_stays (
     id TEXT PRIMARY KEY,
     rating_room DOUBLE PRECISION, rating_breakfast DOUBLE PRECISION,
     rating_service DOUBLE PRECISION, rating_overall DOUBLE PRECISION)`,
  `INSERT INTO users (id) VALUES ('u1')`,
  `INSERT INTO user_settings (id, user_id) VALUES ('s1', 'u1')`,
  `INSERT INTO lodging_stays VALUES
     ('all', 4, 5, 3.5, 4.5),
     ('partial', 4.5, NULL, 2, 3),
     ('overallOnly', NULL, NULL, NULL, 4),
     ('none', NULL, NULL, NULL, NULL)`,
];

type Row = Record<string, unknown>;

describe("migration 20261105182417_lodging_rating_categories", () => {
  let stays: Row[];
  let settings: Row[];

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);
      stays = await tx.$queryRawUnsafe<Row[]>(
        `SELECT id, ratings, rating_room, rating_breakfast, rating_service, rating_overall
           FROM lodging_stays ORDER BY id`
      );
      settings = await tx.$queryRawUnsafe<Row[]>(
        `SELECT lodging_rating_categories FROM user_settings`
      );
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it("keeps every existing room, breakfast and service rating under its key", () => {
    const byId = Object.fromEntries(stays.map((s) => [s.id as string, s]));
    expect(byId.all.ratings).toEqual({ room: 4, breakfast: 5, service: 3.5 });
    // A blank is absent, not zero.
    expect(byId.partial.ratings).toEqual({ room: 4.5, service: 2 });
  });

  it("leaves a stay without component ratings at NULL and does not touch any old column", () => {
    const byId = Object.fromEntries(stays.map((s) => [s.id as string, s]));
    expect(byId.overallOnly.ratings).toBeNull();
    expect(byId.none.ratings).toBeNull();
    expect(byId.all).toMatchObject({
      rating_room: 4,
      rating_breakfast: 5,
      rating_service: 3.5,
      rating_overall: 4.5,
    });
    expect(byId.overallOnly.rating_overall).toBe(4);
  });

  it("gives an existing account today's three categories, so an upgrade changes nothing on screen", () => {
    expect(settings[0].lodging_rating_categories).toEqual(["room", "breakfast", "service"]);
  });
});
