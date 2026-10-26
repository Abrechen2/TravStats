import fs from "fs";
import path from "path";
import { Client } from "pg";

/**
 * `travtrack_share_restriction_recorded_seq` on a database that already holds
 * share restrictions (TravTrack plan T7, Codex review of the share
 * restrictions, fourth round): every existing row gets a record number, the
 * column ends NOT NULL, and a repeat of a recorded restriction draws a new
 * number onto the same row instead of leaving it as the owner's build
 * captured it.
 *
 * Like `migration.locationEvidence.test.ts`, it builds the whole database as
 * it stands before the migration in a throw-away database, writes rows in
 * that shape, then applies the migration on top.
 */

const MIGRATIONS = path.join(__dirname, "../../prisma/migrations");
const NEW = "20261025092702_travtrack_share_restriction_recorded_seq";
const DB = `migtest_share_recorded_seq_${process.pid}`;

function migrationSql(name: string): string {
  return fs.readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf-8");
}

/** Every migration an instance holds before this one, in the order Prisma applies them. */
function earlierMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS)
    .filter((name) => fs.existsSync(path.join(MIGRATIONS, name, "migration.sql")))
    .filter((name) => name !== NEW && (name < NEW || name.startsWith("99999999")))
    .sort();
}

function baseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url.split("?")[0];
}

const withDatabase = (url: string, db: string) => url.replace(/\/[^/]+$/, `/${db}`);

const USER = "u-sharer";
const HOME_A = `{"name":"A","lat":37.5,"lon":127.0}`;
const HOME_B = `{"name":"B","lat":37.6,"lon":127.1}`;

const OLD_SHAPE = [
  `INSERT INTO users (id, username, password_hash) VALUES ('${USER}', 'sharer', 'x')`,
  `INSERT INTO trips (id, user_id, name, updated_at) VALUES ('t1', '${USER}', 'Seoul', now())`,
  `INSERT INTO user_settings (id, user_id, data, home_place, updated_at)
     VALUES ('us1', '${USER}', '{}', '${HOME_A}', now())`,
  `INSERT INTO travtrack_share_snapshots (id, user_id, trip_id, geometry, point_count)
     VALUES ('s1', '${USER}', 't1', '[]', 0)`,
  // Two homes moved away from before the migration, through the trigger.
  `UPDATE user_settings SET home_place = '${HOME_B}' WHERE user_id = '${USER}'`,
  `UPDATE user_settings SET home_place = '${HOME_A}' WHERE user_id = '${USER}'`,
  // A span and a flight recorded by hand, as an older trigger left them.
  `INSERT INTO travtrack_share_past_spans (id, snapshot_id, dedupe_key) VALUES ('ps1', 's1', 'k-span')`,
  `INSERT INTO travtrack_share_past_flights (id, snapshot_id, dep_time_semantics, arr_time_semantics,
     dedupe_key) VALUES ('pf1', 's1', 'local', 'local', 'k-flight')`,
];

type Row = { id: string; recorded_seq: string | null };

describe(`migration ${NEW} — share restrictions get a record number`, () => {
  let admin: Client;
  let db: Client;
  let rows: Record<string, Row[]>;
  let nullable: string[];
  let homeBefore: Row[];
  let homeAfter: Row[];

  const seqs = async (table: string) =>
    (await db.query<Row>(`SELECT id, recorded_seq::text FROM ${table} ORDER BY id`)).rows;

  beforeAll(async () => {
    admin = new Client({ connectionString: baseUrl() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${DB}"`);
    db = new Client({ connectionString: withDatabase(baseUrl(), DB) });
    await db.connect();

    for (const name of earlierMigrations()) await db.query(migrationSql(name));
    for (const sql of OLD_SHAPE) await db.query(sql);
    await db.query(migrationSql(NEW));

    rows = {
      spans: await seqs("travtrack_share_past_spans"),
      flights: await seqs("travtrack_share_past_flights"),
      homes: await seqs("travtrack_share_past_homes"),
    };
    nullable = (
      await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns
         WHERE column_name = 'recorded_seq' AND is_nullable = 'YES'`
      )
    ).rows.map((r) => r.table_name);

    // Home B is recorded already; moving to B and back to A records it again.
    homeBefore = await seqs("travtrack_share_past_homes");
    await db.query(`UPDATE user_settings SET home_place = '${HOME_B}' WHERE user_id = '${USER}'`);
    await db.query(`UPDATE user_settings SET home_place = '${HOME_A}' WHERE user_id = '${USER}'`);
    homeAfter = await seqs("travtrack_share_past_homes");
  });

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin?.end();
  });

  it("gives every existing restriction its own record number", () => {
    const all = [...rows.spans, ...rows.flights, ...rows.homes];
    expect(rows.spans).toHaveLength(1);
    expect(rows.flights).toHaveLength(1);
    expect(rows.homes).toHaveLength(2);
    expect(all.every((r) => r.recorded_seq !== null)).toBe(true);
    expect(new Set(all.map((r) => r.recorded_seq)).size).toBe(all.length);
  });

  it("leaves the column NOT NULL on all three tables", () => {
    expect(nullable).toEqual([]);
  });

  it("a repeat keeps one row per restriction and draws it a newer number", () => {
    expect(homeAfter.map((r) => r.id)).toEqual(homeBefore.map((r) => r.id));
    const maxBefore = Math.max(...homeBefore.map((r) => Number(r.recorded_seq)));
    for (const row of homeAfter) expect(Number(row.recorded_seq)).toBeGreaterThan(maxBefore);
  });
});
