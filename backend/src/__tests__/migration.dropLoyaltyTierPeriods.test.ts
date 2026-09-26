import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20260926175940 drops the dated status history (owner, 2026-09-26).
 * Its promise: no membership is lost, and a status that lived ONLY in the
 * history comes back as the card's current status when the history says it is
 * still held.
 *
 * Replayed in a scratch schema, like `migration.loyaltyMemberships.test.ts`,
 * and in the order a real instance meets it: the 2.6 hotel table, then the
 * 2.7 loyalty migration (which a 2.6 prod instance runs in the same boot), then
 * the history rows a beta user typed in, then this migration.
 */

const MIGRATIONS = path.join(__dirname, "../../prisma/migrations");
const LOYALTY = path.join(MIGRATIONS, "20260925230000_loyalty_memberships/migration.sql");
const DROP = path.join(MIGRATIONS, "20260926175940_drop_loyalty_tier_periods/migration.sql");
const SCHEMA = "migtest_drop_tier_periods";

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

/** The 2.6 tables, as `migration.loyaltyMemberships.test.ts` builds them. */
const PRE_LOYALTY = [
  `CREATE TABLE users (id TEXT PRIMARY KEY)`,
  `CREATE TABLE lodging_chains (id SERIAL PRIMARY KEY)`,
  `CREATE TABLE lodgings (id TEXT PRIMARY KEY)`,
  `CREATE TABLE lodging_memberships (
     id TEXT NOT NULL, user_id TEXT NOT NULL, program_name TEXT NOT NULL,
     membership_number TEXT, tier TEXT,
     created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP(3) NOT NULL,
     CONSTRAINT lodging_memberships_pkey PRIMARY KEY (id))`,
  `CREATE INDEX lodging_memberships_user_id_idx ON lodging_memberships(user_id)`,
  `CREATE UNIQUE INDEX lodging_memberships_user_id_program_name_key ON lodging_memberships(user_id, program_name)`,
  `ALTER TABLE lodging_memberships ADD CONSTRAINT lodging_memberships_user_id_fkey
     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
  `CREATE TABLE lodging_membership_chains (
     membership_id TEXT NOT NULL REFERENCES lodging_memberships(id) ON DELETE CASCADE,
     chain_id INTEGER NOT NULL REFERENCES lodging_chains(id), PRIMARY KEY (membership_id, chain_id))`,
  `CREATE TABLE lodging_stays (
     id TEXT PRIMARY KEY,
     membership_id TEXT REFERENCES lodging_memberships(id) ON DELETE SET NULL)`,
  `INSERT INTO users (id) VALUES ('u1')`,
  `INSERT INTO lodging_chains (id) VALUES (7)`,
  // m1: a 2.6 hotel card with its own status. m2: a card whose status was
  // only ever typed into the history. m3: history that has run out.
  // m4: a card with no history at all. m5: an empty-string status field.
  `INSERT INTO lodging_memberships (id, user_id, program_name, membership_number, tier, updated_at)
     VALUES ('m1', 'u1', 'Marriott Bonvoy', '123', 'Gold', now()),
            ('m2', 'u1', 'Hilton Honors', '456', NULL, now()),
            ('m3', 'u1', 'IHG One', NULL, NULL, now()),
            ('m4', 'u1', 'Accor ALL', '789', NULL, now()),
            ('m5', 'u1', 'Hyatt', NULL, '', now())`,
  `INSERT INTO lodging_membership_chains (membership_id, chain_id) VALUES ('m1', 7)`,
  `INSERT INTO lodging_stays (id, membership_id) VALUES ('s1', 'm1'), ('s2', 'm2')`,
];

/** What a beta user could have entered through the history editor. */
const HISTORY = [
  `INSERT INTO loyalty_memberships (id, user_id, domain, program_name, tier, airline_codes, updated_at)
     VALUES ('f1', 'u1', 'flight', 'Miles & More', NULL, ARRAY['LH'], now())`,
  `INSERT INTO loyalty_tier_periods (id, membership_id, tier, valid_from, valid_until) VALUES
     ('p1', 'm1', 'Platinum', DATE '2024-01-01', NULL),
     ('p2', 'm2', 'Silver',   DATE '2022-01-01', DATE '2023-12-31'),
     ('p3', 'm2', 'Gold',     DATE '2024-01-01', NULL),
     ('p4', 'm3', 'Gold',     DATE '2019-01-01', DATE '2020-12-31'),
     ('p5', 'm5', 'Explorist', DATE '2025-01-01', DATE '2999-12-31'),
     ('p6', 'f1', 'Frequent Traveller', DATE '2023-03-01', NULL),
     ('p7', 'f1', 'Senator', DATE '2025-03-01', NULL)`,
];

type Row = Record<string, unknown>;

describe("migration 20260926175940 — the dated status history is dropped", () => {
  let after: { cards: Row[]; chainLinks: Row[]; stays: Row[]; historyTable: Row[] };

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    after = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_LOYALTY) await tx.$executeRawUnsafe(sql);
      for (const sql of statements(LOYALTY)) await tx.$executeRawUnsafe(sql);
      for (const sql of HISTORY) await tx.$executeRawUnsafe(sql);
      for (const sql of statements(DROP)) await tx.$executeRawUnsafe(sql);

      return {
        cards: await tx.$queryRawUnsafe<Row[]>(
          `SELECT id, domain, program_name, membership_number, tier
             FROM loyalty_memberships ORDER BY id`
        ),
        chainLinks: await tx.$queryRawUnsafe<Row[]>(
          `SELECT membership_id, chain_id FROM lodging_membership_chains`
        ),
        stays: await tx.$queryRawUnsafe<Row[]>(
          `SELECT id, membership_id FROM lodging_stays ORDER BY id`
        ),
        historyTable: await tx.$queryRawUnsafe<Row[]>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = '${SCHEMA}' AND table_name = 'loyalty_tier_periods'`
        ),
      };
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it("keeps every card, and a status held today survives the history it was typed into", () => {
    expect(after.cards).toEqual([
      // A flight card: of two open periods, the latest one is today's status.
      {
        id: "f1",
        domain: "flight",
        program_name: "Miles & More",
        membership_number: null,
        tier: "Senator",
      },
      // The card's own field is the user's answer to "what now" and stays.
      {
        id: "m1",
        domain: "lodging",
        program_name: "Marriott Bonvoy",
        membership_number: "123",
        tier: "Gold",
      },
      // Only in the history, still held: it becomes the card's status.
      {
        id: "m2",
        domain: "lodging",
        program_name: "Hilton Honors",
        membership_number: "456",
        tier: "Gold",
      },
      // Only an expired status: not a current one, so none is invented.
      { id: "m3", domain: "lodging", program_name: "IHG One", membership_number: null, tier: null },
      {
        id: "m4",
        domain: "lodging",
        program_name: "Accor ALL",
        membership_number: "789",
        tier: null,
      },
      // An empty field is no answer; a period ending in the future is held.
      {
        id: "m5",
        domain: "lodging",
        program_name: "Hyatt",
        membership_number: null,
        tier: "Explorist",
      },
    ]);
  });

  it("leaves chain links and stays pointing at their cards", () => {
    expect(after.chainLinks).toEqual([{ membership_id: "m1", chain_id: 7 }]);
    expect(after.stays).toEqual([
      { id: "s1", membership_id: "m1" },
      { id: "s2", membership_id: "m2" },
    ]);
  });

  it("drops the history table", () => {
    expect(after.historyTable).toEqual([]);
  });
});
