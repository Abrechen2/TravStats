import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261108120100 turns every pairing that exists today into one connection (spec
 * 2026-11-08 §11.3, §11.7). Its promise is "no silent widening": a merged connection carries
 * exactly the switches its old rows GRANTED, everything else off. Pending, declined, withdrawn,
 * invited and left rows grant nothing; no two rows are merged by username.
 *
 * The test database has long since run the migration, so both files are replayed against a SCRATCH
 * schema holding the pre-migration shape with real rows in it (the unqualified statements follow
 * `search_path`; the transaction keeps them on one connection).
 */

const DIR = path.join(__dirname, "../../prisma/migrations");
const SCHEMA = "migtest_friends_one_connection";

function statements(file: string): string[] {
  return fs
    .readFileSync(path.join(DIR, file, "migration.sql"), "utf-8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const PRE_MIGRATION = [
  `CREATE TABLE users (id TEXT PRIMARY KEY)`,
  `CREATE TABLE trips (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)`,
  `CREATE TABLE travel_plans (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL)`,
  `CREATE TABLE travel_plan_members (
     id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, kind TEXT NOT NULL, user_id TEXT, status TEXT NOT NULL)`,
  `CREATE TABLE share_consents (
     id TEXT PRIMARY KEY, requester_id TEXT, target_id TEXT, remote_requester_id TEXT,
     remote_target_id TEXT, status TEXT NOT NULL)`,
  `CREATE TABLE leaderboard_remotes (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL, origin TEXT NOT NULL, channel TEXT NOT NULL,
     username TEXT NOT NULL, display_name TEXT NOT NULL)`,
  `CREATE TABLE leaderboard_consents (
     id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, viewer_id TEXT, remote_id TEXT,
     status TEXT NOT NULL, scope JSONB)`,
  `CREATE TABLE remote_share_accounts (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL, origin TEXT NOT NULL, channel TEXT NOT NULL,
     local_channel TEXT NOT NULL, username TEXT NOT NULL, display_name TEXT NOT NULL,
     leaderboard_remote_id TEXT, state TEXT NOT NULL DEFAULT 'active',
     share_leaderboard BOOLEAN NOT NULL DEFAULT false,
     share_plans BOOLEAN NOT NULL DEFAULT false,
     share_trip_offers BOOLEAN NOT NULL DEFAULT false,
     created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  // Five people; ids sort a < b < c < d < e.
  `INSERT INTO users (id) VALUES ('a'), ('b'), ('c'), ('d'), ('e')`,
  // a/b: accepted both ways + an active plan member (b joined a's plan) + leaderboard a->b
  //      with a restricted scope.
  // a/c: only a pending request c -> a, and a withdrawn one a -> c: grants nothing.
  // a/d: only ONE accepted share consent, d -> a (a lets d offer trips); an invited plan member.
  // b/c: a leaderboard consent b -> c that is a pending offer (decided) and c -> b accepted.
  // d/e: a plan member who LEFT, with both consents accepted: share switches only.
  `INSERT INTO share_consents (id, requester_id, target_id, status) VALUES
     ('s1', 'a', 'b', 'accepted'), ('s2', 'b', 'a', 'accepted'),
     ('s3', 'c', 'a', 'pending'), ('s4', 'a', 'c', 'withdrawn'),
     ('s5', 'd', 'a', 'accepted'),
     ('s6', 'd', 'e', 'accepted'), ('s7', 'e', 'd', 'accepted')`,
  `INSERT INTO trips (id, user_id) VALUES ('t1', 'a'), ('t2', 'a'), ('t3', 'd')`,
  `INSERT INTO travel_plans (id, trip_id) VALUES ('p1', 't1'), ('p2', 't2'), ('p3', 't3')`,
  `INSERT INTO travel_plan_members (id, plan_id, kind, user_id, status) VALUES
     ('m1', 'p1', 'local', 'b', 'active'),
     ('m2', 'p2', 'local', 'd', 'invited'),
     ('m3', 'p3', 'local', 'e', 'left')`,
  `INSERT INTO leaderboard_consents (id, owner_id, viewer_id, status, scope) VALUES
     ('l1', 'a', 'b', 'accepted', '{"groups":["distance"],"domains":["flight"],"year":2024}'),
     ('l2', 'b', 'c', 'pending', '{"groups":["trips"],"domains":["flight"],"year":null}'),
     ('l3', 'c', 'b', 'accepted', '{"groups":["trips"],"domains":["flight"],"year":null}')`,
  // Remote: r1 linked to a leaderboard remote, consent accepted but the switch still off;
  // r2 linked, no accepted consent; lbX unlinked + accepted; lbY unlinked + pending question;
  // lbZ unlinked + withdrawn (dead); lbW shares its username with r1's person but is a
  // different channel on a different origin and must NOT be merged into it.
  `INSERT INTO leaderboard_remotes (id, user_id, origin, channel, username, display_name) VALUES
     ('lb1', 'a', 'https://x.test', 'c1', 'lena', 'Lena'),
     ('lb2', 'a', 'https://x.test', 'c2', 'tom', 'Tom'),
     ('lbX', 'a', 'https://y.test', 'cX', 'lena', 'Lena (other)'),
     ('lbY', 'b', 'https://y.test', 'cY', 'ann', 'Ann'),
     ('lbZ', 'b', 'https://y.test', 'cZ', 'old', 'Old')`,
  `INSERT INTO leaderboard_consents (id, owner_id, remote_id, status, scope) VALUES
     ('lr1', 'a', 'lb1', 'accepted', '{"groups":["distance"],"domains":["flight"],"year":null}'),
     ('lr2', 'a', 'lb2', 'withdrawn', NULL),
     ('lrX', 'a', 'lbX', 'accepted', '{"groups":["trips"],"domains":["flight"],"year":null}'),
     ('lrY', 'b', 'lbY', 'pending', NULL),
     ('lrZ', 'b', 'lbZ', 'withdrawn', NULL)`,
  `INSERT INTO remote_share_accounts
     (id, user_id, origin, channel, local_channel, username, display_name, leaderboard_remote_id,
      state, share_plans, share_trip_offers) VALUES
     ('r1', 'a', 'https://x.test', 'sc1', 'lc1', 'lena', 'Lena', 'lb1', 'active', true, true),
     ('r2', 'a', 'https://x.test', 'sc2', 'lc2', 'tom', 'Tom', 'lb2', 'active', false, true),
     ('r3', 'a', 'https://z.test', 'sc3', 'lc3', 'lena', 'Lena', NULL, 'active', true, false)`,
];

type Row = Record<string, unknown>;
const OFF = {
  plans: false,
  stats: "off",
  achievements: false,
  leaderboard: false,
  tripOffers: false,
};

describe("migration 20261108120100 — every pairing becomes one connection without sharing more", () => {
  let locals: Row[];
  let remotes: Row[];
  let oldRows: { consents: Row[]; leaderboard: Row[] };
  let orderRejects: boolean;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements("20261108120000_local_connections"))
        await tx.$executeRawUnsafe(sql);
      for (const sql of statements("20261108120100_friends_one_connection_backfill"))
        await tx.$executeRawUnsafe(sql);
      locals = await tx.$queryRawUnsafe<Row[]>(
        `SELECT user_low_id, user_high_id, state, requested_by, low_switches, high_switches
           FROM local_connections ORDER BY user_low_id, user_high_id`
      );
      remotes = await tx.$queryRawUnsafe<Row[]>(
        `SELECT id, user_id, origin, username, leaderboard_remote_id, state, share_leaderboard,
                share_plans, share_trip_offers FROM remote_share_accounts ORDER BY id`
      );
      oldRows = {
        consents: await tx.$queryRawUnsafe<Row[]>(
          `SELECT id, status FROM share_consents ORDER BY id`
        ),
        leaderboard: await tx.$queryRawUnsafe<Row[]>(
          `SELECT id, status, scope FROM leaderboard_consents ORDER BY id`
        ),
      };
      await tx.$executeRawUnsafe(`SAVEPOINT probe`);
      orderRejects = false;
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO local_connections (id, user_low_id, user_high_id, requested_by)
             VALUES ('bad', 'b', 'a', 'a')`
        );
      } catch {
        orderRejects = true;
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT probe`);
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  const pair = (low: string, high: string) =>
    locals.find((r) => r.user_low_id === low && r.user_high_id === high);

  it("creates exactly one active connection per pair that has a grant, and none for the rest", () => {
    expect(locals.map((r) => `${r.user_low_id}/${r.user_high_id}:${r.state}`)).toEqual([
      "a/b:active",
      "a/d:active",
      "b/c:active",
      "d/e:active",
    ]);
  });

  it("sets each switch on the side that GAVE it, in the grant's direction", () => {
    // a/b: both let the other offer trips, a shows the leaderboard (b->a is no leaderboard grant),
    // b joined a's plan with both consents holding: plans on both sides.
    expect(pair("a", "b")).toMatchObject({
      low_switches: { ...OFF, plans: true, leaderboard: true, tripOffers: true },
      high_switches: { ...OFF, plans: true, tripOffers: true },
    });
    // a/d: only d -> a was accepted: a (the target) lets d offer, d gives nothing. The invited
    // plan member grants no plans.
    expect(pair("a", "d")).toMatchObject({
      low_switches: { ...OFF, tripOffers: true },
      high_switches: OFF,
    });
    // b/c: the pending offer b->c grants nothing, the accepted c->b is c's leaderboard.
    expect(pair("b", "c")).toMatchObject({
      low_switches: OFF,
      high_switches: { ...OFF, leaderboard: true },
    });
    // d/e: a LEFT plan member grants no plans; the two accepted share consents are trip offers.
    expect(pair("d", "e")).toMatchObject({
      low_switches: { ...OFF, tripOffers: true },
      high_switches: { ...OFF, tripOffers: true },
    });
  });

  it("turns nothing pending, declined or withdrawn into a grant (the a/c pair has no row at all)", () => {
    expect(pair("a", "c")).toBeUndefined();
  });

  it("leaves every old row and the stored comparison scope verbatim", () => {
    expect(oldRows.consents).toHaveLength(7);
    expect(oldRows.leaderboard.find((r) => r.id === "l1")).toMatchObject({
      status: "accepted",
      scope: { groups: ["distance"], domains: ["flight"], year: 2024 },
    });
    expect(oldRows.leaderboard.find((r) => r.id === "l2")).toMatchObject({ status: "pending" });
  });

  it("lights the leaderboard switch of a linked pairing whose consent was granted, and nothing else", () => {
    expect(remotes.find((r) => r.id === "r1")).toMatchObject({
      state: "active",
      share_leaderboard: true,
      share_plans: true,
      share_trip_offers: true,
    });
    // Linked but the consent was withdrawn: stays off, plans and offers untouched.
    expect(remotes.find((r) => r.id === "r2")).toMatchObject({
      share_leaderboard: false,
      share_plans: false,
      share_trip_offers: true,
    });
  });

  it("makes an unlinked live leaderboard friend its own reconfirm connection with only the leaderboard switch", () => {
    const x = remotes.find((r) => r.leaderboard_remote_id === "lbX");
    expect(x).toMatchObject({
      user_id: "a",
      origin: "https://y.test",
      username: "lena",
      state: "reconfirm",
      share_leaderboard: true,
      share_plans: false,
      share_trip_offers: false,
    });
    const y = remotes.find((r) => r.leaderboard_remote_id === "lbY");
    expect(y).toMatchObject({ state: "reconfirm", share_leaderboard: false });
  });

  it("never merges two remote rows by username, and skips a dead (withdrawn) leaderboard friend", () => {
    // 'lena' exists three times (r1, r3, lbX's new row) as three different persons.
    expect(remotes.filter((r) => r.username === "lena")).toHaveLength(3);
    expect(remotes.some((r) => r.leaderboard_remote_id === "lbZ")).toBe(false);
    // r3 (unlinked, from an invitation code) is untouched.
    expect(remotes.find((r) => r.id === "r3")).toMatchObject({
      leaderboard_remote_id: null,
      share_plans: true,
    });
  });

  it("keeps the low id sorting first, by bytes", () => {
    expect(orderRejects).toBe(true);
  });
});
