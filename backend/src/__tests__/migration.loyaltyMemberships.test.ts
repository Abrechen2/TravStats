import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20260925230000 turns the hotel-only membership table into the
 * loyalty table for every domain. The promise it makes is "no data loss":
 * every card keeps its id, number and tier, every chain/hotel link and every
 * stay that names a card keeps pointing at it, and every existing card
 * becomes a lodging card.
 *
 * The test database has long since run the migration, so the file is replayed
 * against a SCRATCH schema holding the pre-migration shape with real rows in
 * it. The statements are unqualified, so `search_path` points them at the
 * scratch schema; the transaction keeps them on one connection.
 */

const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20260925230000_loyalty_memberships/migration.sql"
);
const SCHEMA = "migtest_loyalty";

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

/** The tables as `20260809104800_membership_lodging_links` left them. */
const PRE_MIGRATION = [
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
  `CREATE TABLE lodging_membership_lodgings (
     membership_id TEXT NOT NULL REFERENCES lodging_memberships(id) ON DELETE CASCADE,
     lodging_id TEXT NOT NULL REFERENCES lodgings(id), PRIMARY KEY (membership_id, lodging_id))`,
  `CREATE TABLE lodging_stays (
     id TEXT PRIMARY KEY,
     membership_id TEXT REFERENCES lodging_memberships(id) ON DELETE SET NULL)`,
  `INSERT INTO users (id) VALUES ('u1'), ('u2')`,
  `INSERT INTO lodging_chains (id) VALUES (7)`,
  `INSERT INTO lodgings (id) VALUES ('h1')`,
  `INSERT INTO lodging_memberships (id, user_id, program_name, membership_number, tier, updated_at)
     VALUES ('m1', 'u1', 'Marriott Bonvoy', '123', 'Gold', now()),
            ('m2', 'u1', 'Hilton Honors', NULL, NULL, now()),
            ('m3', 'u2', 'Marriott Bonvoy', '999', 'Silver', now())`,
  `INSERT INTO lodging_membership_chains (membership_id, chain_id) VALUES ('m1', 7)`,
  `INSERT INTO lodging_membership_lodgings (membership_id, lodging_id) VALUES ('m2', 'h1')`,
  `INSERT INTO lodging_stays (id, membership_id) VALUES ('s1', 'm1'), ('s2', NULL)`,
];

type Row = Record<string, unknown>;

describe("migration 20260925230000 — lodging memberships become loyalty memberships", () => {
  let after: {
    cards: Row[];
    chainLinks: Row[];
    hotelLinks: Row[];
    stays: Row[];
    domainCheckRejects: boolean;
  };

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    after = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);

      const cards = await tx.$queryRawUnsafe<Row[]>(
        `SELECT id, user_id, domain, program_name, membership_number, tier, airline_codes, cruise_lines
           FROM loyalty_memberships ORDER BY id`
      );
      const chainLinks = await tx.$queryRawUnsafe<Row[]>(
        `SELECT membership_id, chain_id FROM lodging_membership_chains`
      );
      const hotelLinks = await tx.$queryRawUnsafe<Row[]>(
        `SELECT membership_id, lodging_id FROM lodging_membership_lodgings`
      );
      const stays = await tx.$queryRawUnsafe<Row[]>(
        `SELECT id, membership_id FROM lodging_stays ORDER BY id`
      );
      // The CHECK constraint, probed inside a savepoint so its failure does
      // not poison the transaction.
      await tx.$executeRawUnsafe(`SAVEPOINT probe`);
      let domainCheckRejects = false;
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO loyalty_memberships (id, user_id, domain, program_name, updated_at)
             VALUES ('bad', 'u1', 'rail', 'X', now())`
        );
      } catch {
        domainCheckRejects = true;
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT probe`);
      return { cards, chainLinks, hotelLinks, stays, domainCheckRejects };
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it("keeps every card with its id, number and tier, and makes it a lodging card", () => {
    expect(after.cards).toEqual([
      {
        id: "m1",
        user_id: "u1",
        domain: "lodging",
        program_name: "Marriott Bonvoy",
        membership_number: "123",
        tier: "Gold",
        airline_codes: [],
        cruise_lines: [],
      },
      {
        id: "m2",
        user_id: "u1",
        domain: "lodging",
        program_name: "Hilton Honors",
        membership_number: null,
        tier: null,
        airline_codes: [],
        cruise_lines: [],
      },
      {
        id: "m3",
        user_id: "u2",
        domain: "lodging",
        program_name: "Marriott Bonvoy",
        membership_number: "999",
        tier: "Silver",
        airline_codes: [],
        cruise_lines: [],
      },
    ]);
  });

  it("keeps every chain link, hotel link and stay pointing at its card", () => {
    expect(after.chainLinks).toEqual([{ membership_id: "m1", chain_id: 7 }]);
    expect(after.hotelLinks).toEqual([{ membership_id: "m2", lodging_id: "h1" }]);
    expect(after.stays).toEqual([
      { id: "s1", membership_id: "m1" },
      { id: "s2", membership_id: null },
    ]);
  });

  it("refuses a domain outside the vocabulary", () => {
    expect(after.domainCheckRejects).toBe(true);
  });
});
