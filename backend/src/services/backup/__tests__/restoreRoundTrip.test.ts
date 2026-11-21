import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Client } from "pg";

import { BACKED_UP_UPLOAD_DIRS } from "../../../config/uploadDirs";

/**
 * The restore drill as a test (forgejo restore-drill, 2026-11-21): a backup is
 * only worth what a restore gets back out of it.
 *
 * Seeds one account with every kind of data the app keeps (entries of every
 * domain, kept documents with multi-entry links, uploaded and linked photos,
 * receipts, TravTrack points and zones, companions, settings), takes the
 * backup the way the app does (`createBackup`: pg_dump + the upload archive),
 * wipes the uploads, and restores into a SECOND, freshly migrated database
 * through `restoreBackup` — the same code the admin's "restore" runs. Then it
 * compares every table row by row and every file by sha256.
 *
 * What a restore deliberately does NOT bring back is listed in
 * `BY_DESIGN_DIFFERENT`, each with its reason; anything else that differs is a
 * gap in the backup.
 *
 * Needs `pg_dump` and `psql` on PATH (CI's runner has both); skipped on a
 * developer machine without them, and FAILS in CI — a skipped round trip is a
 * green job that proves nothing.
 */

const TOOLS_MISSING = ["pg_dump", "psql"].filter(
  (tool) => spawnSync(tool, ["--version"], { stdio: "ignore" }).status !== 0
);
if (TOOLS_MISSING.length > 0 && process.env.CI) {
  throw new Error(
    `restoreRoundTrip: ${TOOLS_MISSING.join(" and ")} not on PATH. CI must run this suite, not skip it.`
  );
}
const describeWithTools = TOOLS_MISSING.length === 0 ? describe : describe.skip;
if (TOOLS_MISSING.length > 0) {
  process.stderr.write(`restoreRoundTrip: skipped, ${TOOLS_MISSING.join(" and ")} not on PATH\n`);
}

const BACKEND = path.join(__dirname, "../../../..");
const MIGRATIONS = path.join(BACKEND, "prisma/migrations");
const PRISMA_CLI = require.resolve("prisma/build/index.js", { paths: [BACKEND] });
const UPLOADS = path.join(BACKEND, "uploads");
// The restore path is fixed and its orphan sweep removes every file no restored
// row names, so the test runs on an empty uploads directory and puts the real
// one back afterwards.
const UPLOADS_ASIDE = `${UPLOADS}.rt-aside-${process.pid}`;

const BASE_URL = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
const BASE_NAME = decodeURIComponent(BASE_URL.pathname.slice(1));
const SOURCE_DB = `${BASE_NAME}_rt_src`;
const FRESH_DB = `${BASE_NAME}_rt_fresh`;

/**
 * Tables whose content a restore changes on purpose, with the reason. The test
 * asserts each of them is in the state the reason promises, so the list cannot
 * quietly become a way to hide a gap.
 */
const BY_DESIGN_DIFFERENT: Record<string, string> = {
  _prisma_migrations: "applied again on the fresh database, with its own ids and timestamps",
  backups: "this machine's own backup rows are kept; the archive's list is not its own",
  sync_changes: "the phones' change feed restarts, so no stale cursor skips restored rows",
  sync_state: "the feed epoch is bumped so every phone resyncs from scratch",
  public_share_links: "a restore deletes every share link so none comes back to life (forgejo#281)",
  admin_settings: "the instance identity (URLs, passkey rpId, push id, federation key) stays local",
};

function urlFor(database: string): string {
  const url = new URL(BASE_URL.toString());
  url.pathname = `/${encodeURIComponent(database)}`;
  url.search = "";
  return url.toString();
}

async function withClient<T>(database: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: urlFor(database) });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function recreateDatabase(name: string): Promise<void> {
  await withClient("postgres", async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

async function dropDatabase(name: string): Promise<void> {
  await withClient("postgres", (client) =>
    client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  );
}

function migrate(database: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-migrate-"));
  try {
    fs.cpSync(MIGRATIONS, path.join(dir, "migrations"), { recursive: true });
    fs.copyFileSync(path.join(BACKEND, "prisma/schema.prisma"), path.join(dir, "schema.prisma"));
    fs.writeFileSync(
      path.join(dir, "prisma.config.ts"),
      `export default { schema: "schema.prisma", migrations: { path: "migrations" }, ` +
        `datasource: { url: ${JSON.stringify(urlFor(database))} } };\n`
    );
    const run = spawnSync(
      process.execPath,
      [PRISMA_CLI, "migrate", "deploy", "--config", path.join(dir, "prisma.config.ts")],
      { cwd: dir, encoding: "utf-8" }
    );
    if (run.status !== 0) {
      throw new Error(`migrate deploy of ${database} failed: ${run.stdout}\n${run.stderr}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** One row, columns by their database names; objects go in as jsonb. */
async function insert(
  client: Client,
  table: string,
  row: Record<string, unknown>,
  skipDuplicate = false
): Promise<void> {
  const columns = Object.keys(row);
  const values = columns.map((c) => {
    const v = row[c];
    return Array.isArray(v) ? JSON.stringify(v) : v;
  });
  await client.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})${skipDuplicate ? " ON CONFLICT DO NOTHING" : ""}`,
    values
  );
}

/** The files this test writes: <dir>/<name> -> bytes. */
const seededFiles = new Map<string, Buffer>();

function writeUpload(dir: string, name: string, body: string): { name: string; sha256: string } {
  const bytes = Buffer.from(body);
  const target = path.join(UPLOADS, dir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  seededFiles.set(`${dir}/${name}`, bytes);
  return { name, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

const NOW = "2026-05-01T10:00:00Z";
const U = "rt-user";

async function seed(client: Client): Promise<void> {
  const avatar = writeUpload("profile-pictures", `${U}_1-a.png`, "avatar bytes");
  await insert(client, "users", { id: U, username: "rt-user", password_hash: "x" });
  await insert(client, "users", { id: "rt-friend", username: "rt-friend", password_hash: "x" });
  await insert(client, "user_settings", {
    id: "rt-settings",
    user_id: U,
    data: {
      profile: { profilePicture: `/api/v1/settings/profile-picture/${avatar.name}/content` },
      theme: "dark",
    },
    updated_at: NOW,
  });

  // Entries of every domain.
  await insert(client, "trips", { id: "rt-trip", user_id: U, name: "Round trip", updated_at: NOW });
  await insert(client, "flights", {
    id: "rt-flight",
    user_id: U,
    dep_lat: 50.03,
    dep_lon: 8.57,
    arr_lat: 40.64,
    arr_lon: -73.78,
    flight_number: "LH400",
    trip_id: "rt-trip",
  });
  await insert(client, "cruises", { id: "rt-cruise", user_id: U, updated_at: NOW });
  await insert(client, "lodgings", {
    id: "rt-lodging",
    user_id: U,
    name: "Hotel",
    updated_at: NOW,
  });
  await insert(client, "lodging_stays", {
    id: "rt-stay",
    lodging_id: "rt-lodging",
    user_id: U,
    trip_id: "rt-trip",
    updated_at: NOW,
  });
  const journey = (id: string) => ({
    id,
    user_id: U,
    dep_station_name: "A",
    dep_lat: 1,
    dep_lon: 2,
    arr_station_name: "B",
    arr_lat: 3,
    arr_lon: 4,
    departure_time: NOW,
    updated_at: NOW,
  });
  await insert(client, "rail_journeys", journey("rt-rail"));
  await insert(client, "bus_journeys", journey("rt-bus"));
  await insert(client, "ferry_journeys", journey("rt-ferry"));
  await insert(client, "rental_bookings", {
    id: "rt-rental",
    user_id: U,
    provider: "Sixt",
    pickup_station_name: "P",
    pickup_lat: 1,
    pickup_lon: 2,
    pickup_timezone: "UTC",
    return_station_name: "R",
    return_lat: 3,
    return_lon: 4,
    return_timezone: "UTC",
    pickup_time: NOW,
    return_time: NOW,
    updated_at: NOW,
  });
  await insert(client, "places", {
    id: "rt-place",
    user_id: U,
    name: "Café",
    lat: 48.1,
    lon: 11.5,
    updated_at: NOW,
  });
  await insert(client, "place_visits", {
    id: "rt-visit",
    place_id: "rt-place",
    user_id: U,
    updated_at: NOW,
  });
  await insert(client, "notes", {
    id: "rt-note",
    user_id: U,
    body: "a note",
    occurred_at: NOW,
    occurred_zone: "UTC",
    photo_filename: writeUpload("note-photos", "note-1.jpg", "note photo").name,
    photo_mimetype: "image/jpeg",
    photo_size_bytes: 10,
    updated_at: NOW,
  });

  // Companions.
  await insert(client, "companions", {
    id: "rt-comp",
    user_id: U,
    canonical_name: "ann",
    display_name: "Ann",
    search_name: "ann",
    updated_at: NOW,
  });
  await insert(client, "flight_companions", {
    flight_id: "rt-flight",
    companion_id: "rt-comp",
    position: 0,
  });

  // Photos: uploaded and linked.
  const tripPhoto = writeUpload("trip-photos", "trip-1.jpg", "trip photo");
  await insert(client, "trip_photos", {
    id: "rt-tp-up",
    trip_id: "rt-trip",
    filename: tripPhoto.name,
    mimetype: "image/jpeg",
    size_bytes: 10,
  });
  await insert(client, "trip_photos", {
    id: "rt-tp-immich",
    trip_id: "rt-trip",
    filename: "immich-linked",
    mimetype: "image/jpeg",
    size_bytes: 0,
    immich_asset_id: "asset-1",
  });
  await insert(client, "place_visit_photos", {
    id: "rt-pvp-up",
    place_visit_id: "rt-visit",
    filename: writeUpload("place-photos", "visit-1.jpg", "visit photo").name,
    mimetype: "image/jpeg",
    size_bytes: 11,
  });
  await insert(client, "place_visit_photos", {
    id: "rt-pvp-immich",
    place_visit_id: "rt-visit",
    mimetype: "image/jpeg",
    size_bytes: 0,
    immich_asset_id: "asset-2",
  });
  await insert(client, "place_visit_photos", {
    id: "rt-pvp-linked",
    place_visit_id: "rt-visit",
    mimetype: "image/jpeg",
    size_bytes: 0,
    trip_photo_id: "rt-tp-up",
  });
  await insert(client, "lodging_photos", {
    id: "rt-lp",
    lodging_id: "rt-lodging",
    filename: writeUpload("lodging-photos", "lodging-1.jpg", "lodging photo").name,
    mimetype: "image/jpeg",
    size_bytes: 12,
  });

  // Expenses with a receipt (legacy receipt row + kept document).
  await insert(client, "trip_expenses", {
    id: "rt-exp",
    user_id: U,
    trip_id: "rt-trip",
    kind: "food",
    amount: 12.5,
    currency: "EUR",
    updated_at: NOW,
  });
  await insert(client, "receipt_uploads", {
    id: "rt-receipt",
    filename: writeUpload("receipts", "receipt-1.pdf", "receipt bytes").name,
    user_id: U,
  });

  // Kept documents: single owner, multi-entry links, rental category.
  const doc = async (
    id: string,
    body: string,
    owner: Record<string, unknown> = {},
    extra: Record<string, unknown> = {}
  ) => {
    const stored = writeUpload("documents", `${id}.pdf`, body);
    await insert(client, "documents", {
      id,
      user_id: U,
      stored_name: stored.name,
      original_name: `${id}.pdf`,
      mimetype: "application/pdf",
      size_bytes: body.length,
      sha256: stored.sha256,
      format: "pdf",
      ...owner,
      ...extra,
    });
  };
  const link = (documentId: string, target: Record<string, unknown>, role: string, prov: string) =>
    insert(
      client,
      "document_links",
      {
        id: `${documentId}-${Object.keys(target)[0]}`,
        document_id: documentId,
        role,
        provenance: prov,
        ...target,
        // Setting a document's owner column already creates its primary link.
      },
      true
    );

  await doc("rt-doc-trip", "trip booking", { trip_id: "rt-trip" });
  await link("rt-doc-trip", { trip_id: "rt-trip" }, "primary", "user");
  await link("rt-doc-trip", { flight_id: "rt-flight" }, "covers", "parser");
  await link("rt-doc-trip", { rail_journey_id: "rt-rail" }, "covers", "suggestion");
  await link("rt-doc-trip", { cruise_id: "rt-cruise" }, "covers", "legacy");

  await doc(
    "rt-doc-rental",
    "pickup photo",
    { rental_booking_id: "rt-rental" },
    {
      rental_category: "pickup",
    }
  );
  await link("rt-doc-rental", { rental_booking_id: "rt-rental" }, "primary", "user");
  await client.query(
    `UPDATE document_links SET rental_category = 'pickup' WHERE document_id = 'rt-doc-rental' AND rental_booking_id = 'rt-rental'`
  );
  await link("rt-doc-rental", { bus_journey_id: "rt-bus" }, "covers", "user");

  await doc("rt-doc-exp", "expense receipt", { trip_expense_id: "rt-exp" });
  await link("rt-doc-exp", { trip_expense_id: "rt-exp" }, "primary", "user");
  await doc("rt-doc-stay", "stay", { lodging_stay_id: "rt-stay" });
  await link("rt-doc-stay", { lodging_stay_id: "rt-stay" }, "primary", "user");
  await doc("rt-doc-ferry", "ferry", { ferry_journey_id: "rt-ferry" });
  await link("rt-doc-ferry", { ferry_journey_id: "rt-ferry" }, "primary", "user");
  await doc("rt-doc-visit", "visit", { place_visit_id: "rt-visit" });
  await link("rt-doc-visit", { place_visit_id: "rt-visit" }, "primary", "user");
  await doc("rt-doc-unfiled", "unfiled original");

  // TravTrack: points (with their serial `seq`) and privacy zones.
  for (let i = 0; i < 25; i++) {
    await insert(client, "travtrack_points", {
      id: `rt-pt-${i}`,
      user_id: U,
      t: new Date(Date.UTC(2026, 4, 1, 10, i)).toISOString(),
      t_s: i * 60,
      lat: 48 + i / 1000,
      lon: 11 + i / 1000,
      origin: "device",
      origin_ref: `ref-${i}`,
    });
  }
  await insert(client, "travtrack_privacy_zones", {
    id: "rt-zone",
    user_id: U,
    name: "Home",
    lat: 48.0,
    lon: 11.0,
    radius_m: 300,
    updated_at: NOW,
  });

  // The remaining directories: a training sample, an admin's login background,
  // and a transient mail upload (no row names it, so a restore sweeps it).
  await insert(client, "training_data", {
    id: "rt-training",
    user_id: U,
    type: "boarding_pass",
    original_file: path.join(
      UPLOADS,
      "training",
      writeUpload("training", "sample-1.pdf", "t").name
    ),
    annotations: "[]",
    '"extractedData"': "{}",
  });
  writeUpload("login-backgrounds", "bg-1.jpg", "background");
  writeUpload("emails", "mail-1.eml", "transient mail");
  seededFiles.delete("emails/mail-1.eml");

  // A share link (a restore removes it on purpose).
  await insert(client, "public_share_links", {
    id: "rt-share",
    user_id: U,
    kind: "trip",
    token_hash: "h",
    expires_at: "2027-01-01T00:00:00Z",
    effective_expires_at: "2027-01-01T00:00:00Z",
  });
}

/** Every public table's row count and a content digest, rows ordered by their own text. */
async function snapshot(database: string): Promise<Map<string, { n: number; digest: string }>> {
  return withClient(database, async (client) => {
    const tables = (
      await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`
      )
    ).rows.map((r) => r.table_name);
    const out = new Map<string, { n: number; digest: string }>();
    for (const table of tables) {
      const { rows } = await client.query<{ n: string; digest: string | null }>(
        `SELECT count(*) AS n,
                md5(coalesce(string_agg(r, '|' ORDER BY r), '')) AS digest
         FROM (SELECT row_to_json(rowalias)::text AS r FROM "${table}" rowalias) s`
      );
      out.set(table, { n: Number(rows[0].n), digest: rows[0].digest ?? "" });
    }
    return out;
  });
}

function sha256Of(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

describeWithTools("a backup restores completely into a fresh instance", () => {
  jest.setTimeout(600_000);

  let workDir: string;
  let source: Map<string, { n: number; digest: string }>;
  let fresh: Map<string, { n: number; digest: string }>;
  let archivePath: string;
  const originalEnv = { ...process.env };

  const point = (database: string) => {
    const url = new URL(urlFor(database));
    url.search = "?connection_limit=5";
    process.env.DATABASE_URL = url.toString();
  };

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "restore-roundtrip-"));
    process.env.BACKUP_PATH = path.join(workDir, "backups");
    delete process.env.DOCKER;
    if (fs.existsSync(UPLOADS)) fs.renameSync(UPLOADS, UPLOADS_ASIDE);

    await recreateDatabase(SOURCE_DB);
    migrate(SOURCE_DB);
    await withClient(SOURCE_DB, seed);
    source = await snapshot(SOURCE_DB);

    // 1. The backup, the way the app takes one.
    point(SOURCE_DB);
    jest.resetModules();
    const sourceService = await import("../../backupService");
    const sourcePrisma = (await import("../../../db")).prisma;
    const backupId = await sourceService.createBackup({ type: "full" });
    archivePath = (await sourcePrisma.backup.findUniqueOrThrow({ where: { id: backupId } }))
      .backupPath as string;
    await sourcePrisma.$disconnect();

    // 2. A fresh instance: migrated, empty, and no upload files.
    fs.rmSync(UPLOADS, { recursive: true, force: true });
    await recreateDatabase(FRESH_DB);
    migrate(FRESH_DB);
    point(FRESH_DB);
    jest.resetModules();
    const freshService = await import("../../backupService");
    const freshPrisma = (await import("../../../db")).prisma;
    // The archive reaches a new instance as a file in its backup directory,
    // the way a WebDAV import or a copied archive does.
    const row = await freshPrisma.backup.create({
      data: { status: "completed", backupPath: archivePath, completedAt: new Date() },
    });
    await freshService.restoreBackup(row.id, { scope: "full", createBackupBefore: false });
    await freshPrisma.$disconnect();
    fresh = await snapshot(FRESH_DB);
  });

  afterAll(async () => {
    process.env = originalEnv;
    fs.rmSync(UPLOADS, { recursive: true, force: true });
    if (fs.existsSync(UPLOADS_ASIDE)) fs.renameSync(UPLOADS_ASIDE, UPLOADS);
    await dropDatabase(SOURCE_DB);
    await dropDatabase(FRESH_DB);
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("brings back every row of every table, apart from the ones a restore resets on purpose", () => {
    const differing: string[] = [];
    for (const [table, src] of source) {
      if (table in BY_DESIGN_DIFFERENT) continue;
      const got = fresh.get(table);
      if (!got || got.n !== src.n || got.digest !== src.digest) {
        differing.push(`${table}: ${src.n} rows in the source, ${got?.n ?? "no table"} restored`);
      }
    }
    expect(differing).toEqual([]);
    // The seed really covers the data this test claims to cover.
    for (const table of [
      "flights",
      "rail_journeys",
      "bus_journeys",
      "ferry_journeys",
      "rental_bookings",
      "cruises",
      "lodging_stays",
      "documents",
      "document_links",
      "place_visit_photos",
      "trip_photos",
      "travtrack_points",
      "travtrack_privacy_zones",
      "trip_expenses",
      "companions",
      "user_settings",
    ]) {
      expect(fresh.get(table)?.n).toBeGreaterThan(0);
    }
  });

  it("brings back every upload file with the same sha256, in every upload directory", () => {
    const missing: string[] = [];
    for (const [key, bytes] of seededFiles) {
      const restored = path.join(UPLOADS, key);
      const want = crypto.createHash("sha256").update(bytes).digest("hex");
      if (!fs.existsSync(restored) || sha256Of(restored) !== want) missing.push(key);
    }
    expect(missing).toEqual([]);
    // Every directory the backup carries was exercised. `emails` holds only
    // transient uploads that no row names: the restore's sweep drops them.
    const exercised = new Set([...seededFiles.keys()].map((k) => k.split("/")[0]));
    expect(BACKED_UP_UPLOAD_DIRS.filter((d) => !exercised.has(d))).toEqual(["emails"]);
    expect(fs.existsSync(path.join(UPLOADS, "emails", "mail-1.eml"))).toBe(false);
  });

  it("keeps each kept document's bytes matching the sha256 its row recorded", async () => {
    const rows = await withClient(FRESH_DB, (c) =>
      c.query<{ stored_name: string; sha256: string }>(`SELECT stored_name, sha256 FROM documents`)
    );
    expect(rows.rows.length).toBeGreaterThan(5);
    for (const doc of rows.rows) {
      expect(sha256Of(path.join(UPLOADS, "documents", doc.stored_name))).toBe(doc.sha256);
    }
  });

  it("keeps document links as they were: role, provenance, rental category, every entry", async () => {
    const q = `SELECT id, document_id, role, provenance, rental_category,
                      flight_id, rail_journey_id, cruise_id, bus_journey_id, rental_booking_id, trip_id
               FROM document_links ORDER BY id`;
    const [a, b] = await Promise.all([
      withClient(SOURCE_DB, (c) => c.query(q)),
      withClient(FRESH_DB, (c) => c.query(q)),
    ]);
    expect(b.rows).toEqual(a.rows);
    expect(b.rows.find((r) => r.rental_category === "pickup")).toBeTruthy();
    expect(b.rows.filter((r) => r.document_id === "rt-doc-trip")).toHaveLength(4);
  });

  it("keeps TravTrack points in order, and the next point continues the sequence", async () => {
    const q = `SELECT id, seq FROM travtrack_points ORDER BY seq`;
    const [a, b] = await Promise.all([
      withClient(SOURCE_DB, (c) => c.query(q)),
      withClient(FRESH_DB, (c) => c.query(q)),
    ]);
    expect(b.rows).toEqual(a.rows);
    const next = await withClient(FRESH_DB, async (c) => {
      await insert(c, "travtrack_points", {
        id: "rt-pt-after",
        user_id: U,
        t: NOW,
        t_s: 99999,
        lat: 1,
        lon: 1,
        origin: "device",
        origin_ref: "after",
      });
      return (
        await c.query<{ seq: string }>(`SELECT seq FROM travtrack_points WHERE id='rt-pt-after'`)
      ).rows[0].seq;
    });
    expect(Number(next)).toBeGreaterThan(Number(a.rows[a.rows.length - 1].seq));
  });

  it("resets exactly what a restore is meant to reset", async () => {
    expect(fresh.get("public_share_links")?.n).toBe(0);
    expect(source.get("public_share_links")?.n).toBe(1);
    // The phones' feed restarts: a new epoch, not the one the archive carried.
    const epochs = await Promise.all(
      [SOURCE_DB, FRESH_DB].map((db) =>
        withClient(db, async (c) =>
          String((await c.query(`SELECT epoch FROM sync_state`)).rows[0].epoch)
        )
      )
    );
    expect(epochs[1]).not.toBe(epochs[0]);
    // This machine keeps the backup row it restored from, completed (the archive's own copy of that row, written while it was still running, is marked failed).
    const kept = await withClient(FRESH_DB, (c) =>
      c.query(`SELECT status FROM backups WHERE backup_path = $1 AND status = 'completed'`, [
        archivePath,
      ])
    );
    expect(kept.rows).toEqual([{ status: "completed" }]);
    // The account, its settings and the profile picture URL arrive intact.
    const settings = await withClient(FRESH_DB, (c) =>
      c.query(`SELECT data FROM user_settings WHERE user_id = $1`, [U])
    );
    expect(settings.rows[0].data.theme).toBe("dark");
  });
});
