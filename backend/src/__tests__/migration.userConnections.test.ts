import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261102174551 evolves `remote_share_accounts` into the user connection. Its promise:
 * a pairing made before it (invitation code or `directory-pair`) is kept with every trip it
 * carries, becomes `reconfirm`, and shows nothing — statistics back to off, the leaderboard
 * consent withdrawn — until both sides confirm once. Replayed against a SCRATCH schema holding the
 * pre-migration shape with real rows.
 */
const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20261102174551_user_connections/migration.sql"
);
const SCHEMA = "migtest_user_connections";

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
  `CREATE TABLE remote_share_accounts (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL, origin TEXT NOT NULL, channel TEXT NOT NULL,
     local_channel TEXT NOT NULL, username TEXT NOT NULL, display_name TEXT NOT NULL,
     stats_level TEXT NOT NULL DEFAULT 'off', leaderboard_remote_id TEXT)`,
  `CREATE TABLE leaderboard_consents (
     id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, remote_id TEXT, status TEXT NOT NULL,
     decided_at TIMESTAMP(3))`,
  `INSERT INTO remote_share_accounts (id, user_id, origin, channel, local_channel, username, display_name, stats_level, leaderboard_remote_id)
     VALUES ('p1', 'u1', 'https://b.test', 'c1', 'l1', 'ben', 'Ben', 'full', 'lb1'),
            ('p2', 'u1', 'https://c.test', 'c2', 'l2', 'cora', 'Cora', 'off', NULL)`,
  `INSERT INTO leaderboard_consents (id, owner_id, remote_id, status)
     VALUES ('k1', 'u1', 'lb1', 'accepted'), ('k2', 'u1', 'lb-other', 'accepted')`,
];

describe("migration 20261102174551 — pairings become connections to reconfirm", () => {
  let accounts: Record<string, unknown>[];
  let consents: Record<string, unknown>[];
  let stateCheckRejects = false;

  beforeAll(async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await tx.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);
      accounts = await tx.$queryRawUnsafe(`SELECT * FROM remote_share_accounts ORDER BY id`);
      consents = await tx.$queryRawUnsafe(`SELECT * FROM leaderboard_consents ORDER BY id`);
      await tx.$executeRawUnsafe(`SAVEPOINT bad`);
      try {
        await tx.$executeRawUnsafe(`UPDATE remote_share_accounts SET state = 'bogus'`);
      } catch {
        stateCheckRejects = true;
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT bad`);
      }
      await tx.$executeRawUnsafe(`DROP SCHEMA ${SCHEMA} CASCADE`);
    });
  });

  it("keeps every pairing, with its channels, and makes each one reconfirm", () => {
    expect(accounts.map((a) => [a.id, a.channel, a.local_channel, a.state])).toEqual([
      ["p1", "c1", "l1", "reconfirm"],
      ["p2", "c2", "l2", "reconfirm"],
    ]);
  });

  it("shows nothing until both confirm: statistics off, the pairing's leaderboard consent withdrawn", () => {
    expect(accounts.map((a) => a.stats_level)).toEqual(["off", "off"]);
    const byId = Object.fromEntries(consents.map((c) => [c.id, c.status]));
    expect(byId).toEqual({ k1: "withdrawn", k2: "accepted" });
  });

  it("starts every switch off and the counters at zero", () => {
    expect(accounts[0]).toMatchObject({
      share_plans: false,
      share_achievements: false,
      share_leaderboard: false,
      share_trip_offers: false,
      generation: 0,
      peer_generation: 0,
      remote_switches: {},
    });
  });

  it("closes the state vocabulary with a CHECK", () => {
    expect(stateCheckRejects).toBe(true);
  });
});
