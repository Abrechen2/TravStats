import fs from "fs";
import path from "path";
import { Client } from "pg";

/**
 * The upgrade of a real Phase 2 database by `location_evidence` (TravTrack
 * plan, task E1; review focus 1 and 17 — Dawarich users see nothing change).
 *
 * Unlike the scratch-schema replays beside it, this one builds the WHOLE
 * database as it stands before the migration: a throw-away database, every
 * earlier migration replayed in Prisma's order (the late-numbered
 * `99999999999999_remove_imported_flights` included, as every upgraded
 * instance has it), rows written in that shape, then this migration on top.
 * The migration touches four existing tables, so a hand-built pre-image of
 * them would be a second description of the schema that could drift.
 */

const MIGRATIONS = path.join(__dirname, "../../prisma/migrations");
const NEW = "20261025074104_location_evidence";
const DB = `migtest_location_evidence_${process.pid}`;

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

const USER = "u-dawarich";
const STAY_EVIDENCE_PENDING = {
  source: "dawarich",
  zone: "Asia/Seoul",
  pointIds: [9_100_001, 9_100_002, 9_100_003],
  maxGapMinutes: 4,
  uncertainties: ["placeAmbiguous"],
  matchingVisitId: null,
};
const STAY_EVIDENCE_ACCEPTED = {
  source: "dawarich",
  kind: "market",
  market: { name: "Gwangjang", venueType: "market" },
  supersededFindingIds: [],
  zone: "Asia/Seoul",
  pointIds: [9_200_001, 9_200_002],
  maxGapMinutes: 11,
  uncertainties: [],
  matchingVisitId: "v1",
};

const OLD_SHAPE = [
  `INSERT INTO users (id, username, password_hash) VALUES ('${USER}', 'dawarich-user', 'x'), ('u-other', 'other', 'x')`,
  `INSERT INTO places (id, user_id, name, lat, lon, updated_at)
     VALUES ('p1', '${USER}', 'Gwangjang', 37.57, 126.99, now())`,
  `INSERT INTO place_visits (id, place_id, user_id, visited_at, updated_at)
     VALUES ('v1', 'p1', '${USER}', '2026-10-12 10:00', now())`,
  `INSERT INTO dawarich_stays (id, user_id, fingerprint, source_start_at, source_end_at, source_lat,
     source_lon, status, start_at, end_at, lat, lon, zone, point_count, evidence)
     VALUES ('s-pending', '${USER}', 'fp-pending', '2026-10-11 09:00', '2026-10-11 10:30', 37.5665,
       126.978, 'pending', '2026-10-11 09:00', '2026-10-11 10:30', 37.5665, 126.978, 'Asia/Seoul', 3,
       '${JSON.stringify(STAY_EVIDENCE_PENDING)}')`,
  `INSERT INTO dawarich_stays (id, user_id, fingerprint, source_start_at, source_end_at, source_lat,
     source_lon, status, start_at, end_at, lat, lon, zone, point_count, evidence, place_id, visit_id,
     resolved_at)
     VALUES ('s-accepted', '${USER}', 'fp-accepted', '2026-10-12 09:40', '2026-10-12 10:20', 37.57,
       126.99, 'accepted', '2026-10-12 09:40', '2026-10-12 10:20', 37.57, 126.99, 'Asia/Seoul', 2,
       '${JSON.stringify(STAY_EVIDENCE_ACCEPTED)}', 'p1', 'v1', now())`,
  `INSERT INTO dawarich_stay_scans (user_id, enabled, result, point_count, created_count)
     VALUES ('${USER}', true, 'complete', 5, 2)`,
  `INSERT INTO travtrack_points (id, user_id, t, t_s, lat, lon, origin, origin_ref)
     VALUES ('tp1', '${USER}', to_timestamp(1760000000), 1760000000, 37.5, 127.0, 'companion:d', 'r1')`,
];

type Snapshot = Record<string, unknown>;

describe(`migration ${NEW} — upgrading a Phase 2 database`, () => {
  let admin: Client;
  let db: Client;
  let before: { stays: Snapshot[] };
  let after: Record<string, Snapshot[]>;
  let refused: Record<string, boolean>;
  let accepted: Record<string, boolean>;
  let leftForDeletedUser: Record<string, number>;

  const query = async <T extends Snapshot>(sql: string): Promise<T[]> =>
    (await db.query<T>(sql)).rows;

  const refuses = async (sql: string): Promise<boolean> => {
    await db.query("SAVEPOINT probe");
    try {
      await db.query(sql);
      await db.query("RELEASE SAVEPOINT probe");
      return false;
    } catch {
      await db.query("ROLLBACK TO SAVEPOINT probe");
      return true;
    }
  };

  const STAYS = `SELECT id, fingerprint, status, evidence::text AS evidence_text, place_id, visit_id
                 FROM dawarich_stays ORDER BY id`;

  beforeAll(async () => {
    admin = new Client({ connectionString: baseUrl() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${DB}"`);
    db = new Client({ connectionString: withDatabase(baseUrl(), DB) });
    await db.connect();

    // The Phase 2 schema, exactly as `migrate deploy` leaves it.
    for (const name of earlierMigrations()) await db.query(migrationSql(name));
    for (const sql of OLD_SHAPE) await db.query(sql);
    before = { stays: await query(STAYS) };

    await db.query(migrationSql(NEW));

    after = {
      stays: await query(
        `SELECT id, fingerprint, status, evidence::text AS evidence_text, place_id, visit_id,
                provider, provider_rev, algorithm_version, evidence_key, claim_token, claimed_at
         FROM dawarich_stays ORDER BY id`
      ),
      scans: await query(`SELECT user_id, enabled, result, provider FROM dawarich_stay_scans`),
      visits: await query(`SELECT id, place_id, suggestion_ref FROM place_visits`),
      points: await query(`SELECT id FROM travtrack_points`),
    };

    await db.query("BEGIN");
    refused = {
      stayProviderGps: await refuses(
        `UPDATE dawarich_stays SET provider = 'gps' WHERE id = 's-pending'`
      ),
      scanProviderGps: await refuses(
        `UPDATE dawarich_stay_scans SET provider = 'gps' WHERE user_id = '${USER}'`
      ),
      suggestionKindStay: await refuses(
        `INSERT INTO location_suggestions (id, user_id, kind, provider, provider_rev, algorithm,
           evidence_key, window_from, window_until, explanation, evidence)
         VALUES ('q9', '${USER}', 'stay', 'travtrack', 0, 1, 'k9', now(), now() + interval '1 day',
           '{}', '{}')`
      ),
      suggestionStatus: await refuses(
        `INSERT INTO location_suggestions (id, user_id, kind, provider, provider_rev, algorithm,
           evidence_key, window_from, window_until, status, explanation, evidence)
         VALUES ('q8', '${USER}', 'country', 'travtrack', 0, 1, 'k8', now(), now() + interval '1 day',
           'maybe', '{}', '{}')`
      ),
      importKind: await refuses(
        `INSERT INTO travtrack_imports (id, user_id, kind, file_name, status)
         VALUES ('i9', '${USER}', 'kml', 'a.kml', 'running')`
      ),
      tokenKind: await refuses(
        `INSERT INTO travtrack_ingest_tokens (id, user_id, kind, label, lookup_hash, hash)
         VALUES ('t9', '${USER}', 'gpslogger', 'x', 'l9', 'h')`
      ),
    };
    accepted = {
      stayProviderTravTrack: !(await refuses(
        `UPDATE dawarich_stays SET provider = 'travtrack' WHERE id = 's-pending'`
      )),
    };
    await db.query("ROLLBACK");

    // Every new table takes a row of the account, so its cascade is observable.
    for (const sql of [
      `INSERT INTO location_suggestions (id, user_id, kind, provider, provider_rev, algorithm,
         evidence_key, window_from, window_until, explanation, evidence)
       VALUES ('q1', '${USER}', 'country', 'travtrack', 0, 1, 'k1', now(), now() + interval '1 day',
         '{"code":"country.days","params":{}}', '{}')`,
      `INSERT INTO travtrack_dirty_days (user_id, day, version) VALUES ('${USER}', '2026-10-11', 1)`,
      `INSERT INTO travtrack_derivation_state (user_id) VALUES ('${USER}')`,
      `INSERT INTO travtrack_imports (id, user_id, kind, file_name, status)
         VALUES ('i1', '${USER}', 'gpx', 'walk.gpx', 'running')`,
      `INSERT INTO travtrack_ingest_tokens (id, user_id, kind, label, lookup_hash, hash)
         VALUES ('t1', '${USER}', 'owntracks', 'Pixel', 'l1', 'h')`,
      `UPDATE place_visits SET suggestion_ref = 'k-stay' WHERE id = 'v1'`,
    ]) {
      await db.query(sql);
    }
    await db.query(`DELETE FROM users WHERE id = '${USER}'`);
    leftForDeletedUser = {};
    for (const table of [
      "location_suggestions",
      "travtrack_dirty_days",
      "travtrack_derivation_state",
      "travtrack_imports",
      "travtrack_ingest_tokens",
      "dawarich_stays",
      "dawarich_stay_scans",
      "place_visits",
    ]) {
      const rows = await query<{ n: string }>(
        `SELECT count(*) AS n FROM ${table} WHERE user_id = '${USER}'`
      );
      leftForDeletedUser[table] = Number(rows[0]?.n ?? 0);
    }
  }, 180_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin?.end();
  });

  it("keeps every Dawarich stay, with its evidence and fingerprint byte-identical", () => {
    expect(after.stays).toHaveLength(2);
    for (const old of before.stays) {
      const now = after.stays.find((row) => row.id === old.id);
      expect(now).toMatchObject(old);
    }
    expect(JSON.parse(String(after.stays[0].evidence_text))).toEqual(STAY_EVIDENCE_ACCEPTED);
    expect(JSON.parse(String(after.stays[1].evidence_text))).toEqual(STAY_EVIDENCE_PENDING);
  });

  it("marks every existing stay as Dawarich's, before versioning, with no key and no claim", () => {
    for (const row of after.stays) {
      expect(row).toMatchObject({
        provider: "dawarich",
        provider_rev: 0,
        algorithm_version: 0,
        evidence_key: null,
        claim_token: null,
        claimed_at: null,
      });
    }
  });

  it("keeps the scan row, the visit and the TravTrack points", () => {
    expect(after.scans).toEqual([
      { user_id: USER, enabled: true, result: "complete", provider: null },
    ]);
    expect(after.visits).toEqual([{ id: "v1", place_id: "p1", suggestion_ref: null }]);
    expect(after.points).toEqual([{ id: "tp1" }]);
  });

  it("the CHECKs refuse a provider, kind or status outside their vocabulary", () => {
    expect(refused).toEqual({
      stayProviderGps: true,
      scanProviderGps: true,
      suggestionKindStay: true,
      suggestionStatus: true,
      importKind: true,
      tokenKind: true,
    });
    expect(accepted.stayProviderTravTrack).toBe(true);
  });

  it("deleting the user removes every new row", () => {
    expect(Object.values(leftForDeletedUser).every((n) => n === 0)).toBe(true);
    expect(leftForDeletedUser).toEqual({
      location_suggestions: 0,
      travtrack_dirty_days: 0,
      travtrack_derivation_state: 0,
      travtrack_imports: 0,
      travtrack_ingest_tokens: 0,
      dawarich_stays: 0,
      dawarich_stay_scans: 0,
      place_visits: 0,
    });
  });
});
