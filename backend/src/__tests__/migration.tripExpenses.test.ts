import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261001120000 moves the per-leg toll (`trip_route_legs.toll_cost`
 * + `currency`) into `trip_expenses` as `kind = 'toll'` rows and drops the two
 * columns (forgejo#140, owner 2026-10-01: one source of truth for totals).
 *
 * It is hand-written because `prisma migrate dev` would emit the column drop
 * with no copy in front of it — every stored toll gone. The promise is "no
 * toll lost": each non-null toll becomes exactly one expense on the leg's
 * route, between the leg's two stops, in its currency, dated by the stops
 * where they carry a day.
 *
 * The test database has long since run the migration, so the file is replayed
 * against a SCRATCH schema holding the pre-migration shape with real rows in
 * it (template: `migration.loyaltyMemberships.test.ts`).
 */

const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20261001120000_trip_expenses/migration.sql"
);
const SCHEMA = "migtest_trip_expenses";

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

/** The tables as `20260927140000_rail_routing_url` left them, cut to what the migration reads. */
const PRE_MIGRATION = [
  `CREATE TABLE users (id TEXT PRIMARY KEY)`,
  `CREATE TABLE user_settings (user_id TEXT PRIMARY KEY, base_currency TEXT NOT NULL DEFAULT 'EUR')`,
  `CREATE TABLE trips (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)`,
  `CREATE TABLE trip_routes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, trip_id TEXT)`,
  `CREATE TABLE trip_stops (
     id TEXT PRIMARY KEY, start_date TIMESTAMP(3), end_date TIMESTAMP(3))`,
  `CREATE TABLE trip_route_legs (
     id TEXT PRIMARY KEY, route_id TEXT NOT NULL, from_stop_id TEXT NOT NULL,
     to_stop_id TEXT NOT NULL, toll_cost DOUBLE PRECISION, currency TEXT,
     updated_at TIMESTAMP(3) NOT NULL)`,
  `INSERT INTO users (id) VALUES ('u1'), ('u2')`,
  // u1 keeps accounts in CHF; u2 never opened the settings, so has no row.
  `INSERT INTO user_settings (user_id, base_currency) VALUES ('u1', 'CHF')`,
  `INSERT INTO trips (id, user_id) VALUES ('t1', 'u1')`,
  `INSERT INTO trip_routes (id, user_id, trip_id) VALUES ('r1', 'u1', 't1'), ('r2', 'u2', NULL)`,
  `INSERT INTO trip_stops (id, start_date, end_date) VALUES
     ('a', '2026-07-14 00:00:00', '2026-07-15 00:00:00'),
     ('b', '2026-07-16 00:00:00', NULL),
     ('c', NULL, NULL),
     ('d', NULL, NULL),
     ('e', NULL, NULL)`,
  `INSERT INTO trip_route_legs (id, route_id, from_stop_id, to_stop_id, toll_cost, currency, updated_at) VALUES
     ('l1', 'r1', 'a', 'b', 12.5, 'EUR', '2026-07-20 10:00:00'),
     ('l2', 'r1', 'b', 'c', NULL, 'EUR', '2026-07-20 10:00:00'),
     ('l3', 'r1', 'c', 'b', 7, NULL, '2026-07-20 10:00:00'),
     ('l4', 'r2', 'c', 'd', 30, NULL, '2026-07-20 10:00:00'),
     ('l5', 'r2', 'd', 'e', 5.25, 'nok', '2026-07-20 10:00:00'),
     ('l6', 'r2', 'e', 'c', 9, 'E1R', '2026-07-20 10:00:00'),
     ('l7', 'r1', 'b', 'a', 0, 'EUR', '2026-07-20 10:00:00')`,
];

type Row = Record<string, unknown>;

describe("migration 20261001120000 — leg tolls become trip expenses", () => {
  let after: {
    expenses: Row[];
    legs: Row[];
    legColumns: string[];
    rejects: Record<string, boolean>;
  };

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    after = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);

      const expenses = await tx.$queryRawUnsafe<Row[]>(
        `SELECT user_id, trip_id, route_id, stop_id, leg_from_stop_id, leg_to_stop_id,
                kind, amount::text AS amount, currency, to_char(date, 'YYYY-MM-DD') AS date, note
           FROM trip_expenses ORDER BY route_id, leg_from_stop_id, leg_to_stop_id`
      );
      const legs = await tx.$queryRawUnsafe<Row[]>(`SELECT id FROM trip_route_legs ORDER BY id`);
      const columns = await tx.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = '${SCHEMA}' AND table_name = 'trip_route_legs'`
      );

      // Each constraint probed inside a savepoint, so a refusal does not
      // poison the transaction.
      const probes: Record<string, string> = {
        bothScopes: `INSERT INTO trip_expenses (id, user_id, trip_id, route_id, kind, amount, currency, updated_at)
                       VALUES ('x1', 'u1', 't1', 'r1', 'toll', 1, 'EUR', now())`,
        noScope: `INSERT INTO trip_expenses (id, user_id, kind, amount, currency, updated_at)
                    VALUES ('x2', 'u1', 'toll', 1, 'EUR', now())`,
        unknownKind: `INSERT INTO trip_expenses (id, user_id, trip_id, kind, amount, currency, updated_at)
                        VALUES ('x3', 'u1', 't1', 'bribe', 1, 'EUR', now())`,
        negativeAmount: `INSERT INTO trip_expenses (id, user_id, trip_id, kind, amount, currency, updated_at)
                           VALUES ('x4', 'u1', 't1', 'fuel', -1, 'EUR', now())`,
        stationAndLeg: `INSERT INTO trip_expenses (id, user_id, route_id, stop_id, leg_from_stop_id, leg_to_stop_id, kind, amount, currency, updated_at)
                          VALUES ('x6', 'u1', 'r1', 'a', 'a', 'b', 'toll', 1, 'EUR', now())`,
        lowerCurrency: `INSERT INTO trip_expenses (id, user_id, trip_id, kind, amount, currency, updated_at)
                          VALUES ('x5', 'u1', 't1', 'fuel', 1, 'eur', now())`,
      };
      const rejects: Record<string, boolean> = {};
      for (const [name, sql] of Object.entries(probes)) {
        await tx.$executeRawUnsafe(`SAVEPOINT probe`);
        try {
          await tx.$executeRawUnsafe(sql);
          rejects[name] = false;
        } catch {
          rejects[name] = true;
        }
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT probe`);
      }
      return { expenses, legs, legColumns: columns.map((c) => c.column_name), rejects };
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  const base = { trip_id: null, stop_id: null, kind: "toll" };

  it("turns every stored toll into one expense between the leg's stops, on the leg's route", () => {
    expect(after.expenses).toEqual([
      // Dated by the day the leg left its first stop.
      {
        ...base,
        user_id: "u1",
        route_id: "r1",
        leg_from_stop_id: "a",
        leg_to_stop_id: "b",
        amount: "12.5000",
        currency: "EUR",
        date: "2026-07-15",
        note: null,
      },
      // A zero toll was stated, so it stays stated.
      {
        ...base,
        user_id: "u1",
        route_id: "r1",
        leg_from_stop_id: "b",
        leg_to_stop_id: "a",
        amount: "0.0000",
        currency: "EUR",
        date: "2026-07-16",
        note: null,
      },
      // No currency on the leg: the owner's base currency; dated by the arrival stop.
      {
        ...base,
        user_id: "u1",
        route_id: "r1",
        leg_from_stop_id: "c",
        leg_to_stop_id: "b",
        amount: "7.0000",
        currency: "CHF",
        date: "2026-07-16",
        note: null,
      },
      // No settings row at all: the schema default EUR. No day anywhere: undated.
      {
        ...base,
        user_id: "u2",
        route_id: "r2",
        leg_from_stop_id: "c",
        leg_to_stop_id: "d",
        amount: "30.0000",
        currency: "EUR",
        date: null,
        note: null,
      },
      // Lower-case code normalised.
      {
        ...base,
        user_id: "u2",
        route_id: "r2",
        leg_from_stop_id: "d",
        leg_to_stop_id: "e",
        amount: "5.2500",
        currency: "NOK",
        date: null,
        note: null,
      },
      // Not a currency code: the amount is kept, the text it was stored with
      // too — in the note, so nothing the user typed is thrown away.
      {
        ...base,
        user_id: "u2",
        route_id: "r2",
        leg_from_stop_id: "e",
        leg_to_stop_id: "c",
        amount: "9.0000",
        currency: "EUR",
        date: null,
        note: "Toll moved from the leg, stored currency was 'E1R'",
      },
    ]);
  });

  it("keeps every leg and drops only the two toll columns", () => {
    expect(after.legs.map((l) => l.id)).toEqual(["l1", "l2", "l3", "l4", "l5", "l6", "l7"]);
    expect(after.legColumns).not.toContain("toll_cost");
    expect(after.legColumns).not.toContain("currency");
    expect(after.legColumns).toContain("from_stop_id");
  });

  it("refuses a row that breaks the scope, kind, amount, station-or-leg or currency rule", () => {
    expect(after.rejects).toEqual({
      bothScopes: true,
      noScope: true,
      unknownKind: true,
      negativeAmount: true,
      stationAndLeg: true,
      lowerCurrency: true,
    });
  });
});
