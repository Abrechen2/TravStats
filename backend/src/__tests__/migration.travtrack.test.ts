import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * Migration 20261024200938 creates TravTrack's tables (TravTrack plan, T1) and
 * carries hand-appended CHECK constraints that Prisma cannot express. Replayed
 * against a SCRATCH schema holding just the two tables it references, the way
 * `migration.loyaltyMemberships.test.ts` does it, so the constraints, the two
 * unique keys of a point and the cascades are pinned on the SQL itself.
 */

const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20261024200938_travtrack/migration.sql"
);
const SCHEMA = "migtest_travtrack";

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
  `CREATE TABLE trips (id TEXT PRIMARY KEY)`,
  `INSERT INTO users (id) VALUES ('u1'), ('u2')`,
  `INSERT INTO trips (id) VALUES ('t1')`,
];

const point = (id: string, user: string, tS: number, ref: string, extra = "") =>
  `INSERT INTO travtrack_points (id, user_id, t, t_s, lat, lon, origin, origin_ref${
    extra ? ", purpose" : ""
  }) VALUES ('${id}', '${user}', to_timestamp(${tS}), ${tS}, 1.5, 2.5, 'companion:d', '${ref}'${
    extra ? `, '${extra}'` : ""
  })`;

type Probe = Record<string, boolean | number>;

describe("migration 20261024200938 — TravTrack", () => {
  let probe: Probe;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    probe = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);

      const refused = async (sql: string): Promise<boolean> => {
        await tx.$executeRawUnsafe(`SAVEPOINT probe`);
        try {
          await tx.$executeRawUnsafe(sql);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT probe`);
          return false;
        } catch {
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT probe`);
          return true;
        }
      };
      const count = async (table: string, where = "TRUE"): Promise<number> => {
        const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM ${table} WHERE ${where}`
        );
        return Number(rows[0]?.n ?? 0);
      };

      await tx.$executeRawUnsafe(point("p1", "u1", 1_760_000_000, "r1", "trip"));
      const result: Probe = {
        purposeWalk: await refused(point("p9", "u1", 1_760_000_100, "r9", "walk")),
        samePosition: await refused(point("p2", "u1", 1_760_000_000, "other-ref")),
        sameRef: await refused(point("p3", "u1", 1_760_000_500, "r1")),
        otherUserSamePosition: !(await refused(point("p4", "u2", 1_760_000_000, "r1"))),
        linkCruise: await refused(
          `INSERT INTO travtrack_point_links (user_id, point_id, entry_kind, entry_id)
           VALUES ('u1', 'p1', 'cruise', 'c1')`
        ),
        gapReason: await refused(
          `INSERT INTO travtrack_gaps (id, user_id, device_id, from_at, to_at, reason)
           VALUES ('g9', 'u1', 'd', now(), now() + interval '1 hour', 'zone')`
        ),
        gapBackwards: await refused(
          `INSERT INTO travtrack_gaps (id, user_id, device_id, from_at, to_at, reason)
           VALUES ('g8', 'u1', 'd', now(), now() - interval '1 hour', 'permission')`
        ),
      };
      await tx.$executeRawUnsafe(
        `INSERT INTO travtrack_point_links (user_id, point_id, entry_kind, entry_id)
         VALUES ('u1', 'p1', 'trip', 't1'), ('u1', 'p1', 'flight', 'f1')`
      );
      await tx.$executeRawUnsafe(`DELETE FROM travtrack_points WHERE id = 'p1'`);
      result.linksAfterPointDelete = await count("travtrack_point_links");

      await tx.$executeRawUnsafe(point("p5", "u1", 1_760_000_900, "r5"));
      await tx.$executeRawUnsafe(
        `INSERT INTO travtrack_point_links (user_id, point_id, entry_kind, entry_id)
         VALUES ('u1', 'p5', 'trip', 't1')`
      );
      for (const sql of [
        `INSERT INTO travtrack_uploads (id, user_id, upload_id, payload_hash, result)
           VALUES ('up', 'u1', 'x', 'h', '{}')`,
        `INSERT INTO travtrack_deleted_ranges (id, user_id, from_at, to_at)
           VALUES ('dr', 'u1', now(), now() + interval '1 day')`,
        `INSERT INTO travtrack_privacy_zones (id, user_id, name, lat, lon, radius_m, updated_at)
           VALUES ('z', 'u1', 'Zuhause', 1, 1, 100, now())`,
        `INSERT INTO travtrack_gaps (id, user_id, device_id, from_at, to_at, reason)
           VALUES ('g', 'u1', 'd', now(), now() + interval '1 hour', 'recorderSilent')`,
        `INSERT INTO travtrack_share_snapshots (id, user_id, trip_id, geometry, point_count)
           VALUES ('s', 'u1', 't1', '[]', 0)`,
      ]) {
        await tx.$executeRawUnsafe(sql);
      }
      await tx.$executeRawUnsafe(`DELETE FROM users WHERE id = 'u1'`);
      let left = 0;
      for (const table of [
        "travtrack_points",
        "travtrack_point_links",
        "travtrack_uploads",
        "travtrack_deleted_ranges",
        "travtrack_privacy_zones",
        "travtrack_gaps",
        "travtrack_share_snapshots",
      ]) {
        left += await count(table, `user_id = 'u1'`);
      }
      result.rowsLeftForDeletedUser = left;
      return result;
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it("refuses a purpose outside everyday|flight|trip", () => {
    expect(probe.purposeWalk).toBe(true);
  });

  it("refuses a link to anything but a flight or a trip", () => {
    expect(probe.linkCruise).toBe(true);
  });

  it("refuses a gap with an unknown reason or a backwards span", () => {
    expect(probe.gapReason).toBe(true);
    expect(probe.gapBackwards).toBe(true);
  });

  it("holds both unique keys of a point, per account", () => {
    expect(probe.samePosition).toBe(true);
    expect(probe.sameRef).toBe(true);
    expect(probe.otherUserSamePosition).toBe(true);
  });

  it("deleting a point removes its links", () => {
    expect(probe.linksAfterPointDelete).toBe(0);
  });

  it("deleting a user removes every travtrack_* row", () => {
    expect(probe.rowsLeftForDeletedUser).toBe(0);
  });
});
