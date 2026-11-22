/**
 * The account archive round trip (forgejo#433): one account with every kind of
 * data, exported to a ZIP on one database and imported into a fresh account on a
 * second, freshly migrated one — what moving an account to another server is.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "pg";

import { createPrismaClient } from "../../../prismaClient";
import type { PrismaClient } from "../../../prisma";
import { readCatalog, type Db } from "../catalog";
import { writeAccountArchive } from "../exportArchive";
import { importAccountArchive } from "../importArchive";
import { recordPendingDeletions } from "../../files/pendingDeletions";
import { buildPlan, selectionWhere, type ArchivePlan } from "../plan";
import {
  BASE_URL,
  dropDatabase,
  listFiles,
  migrate,
  readZip,
  recreateDatabase,
  urlFor,
  writeZip,
} from "./archiveHelpers";
import {
  CATALOGUE,
  cleanSeed,
  FRIEND,
  POINTS,
  SECRETS,
  SeedFiles,
  seedAccount,
  seedCatalogue,
  seedCrossLinks,
  seedOtherAccount,
  U,
} from "./archiveSeed";

jest.setTimeout(180_000);

const TARGET_DB = `${decodeURIComponent(BASE_URL.pathname.slice(1))}_az_target`;
const TARGET_USER = "az-target-0001";
const OTHER_TARGET_USER = "az-target-other";
const SPARE_TARGET_USER = "az-target-spare";
const TARGET_PORT_ID = 4242;

let work: string;
let srcRoot: string;
let dstRoot: string;
let zipPath: string;
let src: Client;
let dst: Client;
let dstPrisma: PrismaClient;
let plan: ArchivePlan;
let seeded: SeedFiles;
let importResult: Awaited<ReturnType<typeof importAccountArchive>>;

async function counts(client: Client, userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const p of plan.tables) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM "${p.table.name}" t0 WHERE ${selectionWhere(plan, p.table.name)}`,
      [userId]
    );
    if (rows[0].n > 0) out[p.table.name] = rows[0].n;
  }
  return out;
}

async function one<T = Record<string, unknown>>(
  client: Client,
  sql: string,
  params: unknown[] = []
): Promise<T> {
  const { rows } = await client.query(sql, params);
  return rows[0] as T;
}

/** The archive with some entries replaced, its manifest recomputed, under a new id. */
async function repack(
  changes: (entries: Map<string, Buffer>) => void,
  name: string
): Promise<string> {
  const entries = await readZip(zipPath);
  changes(entries);
  const manifest = JSON.parse(entries.get("manifest.json")!.toString());
  manifest.archiveId = crypto.randomUUID();
  manifest.entries = manifest.entries.map((e: { name: string }) => {
    const bytes = entries.get(e.name)!;
    return {
      ...e,
      bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  });
  entries.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  const file = path.join(work, name);
  await writeZip(file, entries);
  return file;
}

function editLines(
  entries: Map<string, Buffer>,
  entry: string,
  edit: (row: Record<string, unknown>) => Record<string, unknown>
): void {
  const lines = entries.get(entry)!.toString().split("\n").filter(Boolean);
  entries.set(
    entry,
    Buffer.from(lines.map((l) => JSON.stringify(edit(JSON.parse(l)))).join("\n") + "\n")
  );
}

async function freshUser(id: string): Promise<string> {
  await dst.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [id]);
  return id;
}

const sha = (file: string) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "az-archive-"));
  srcRoot = path.join(work, "src-uploads");
  dstRoot = path.join(work, "dst-uploads");
  zipPath = path.join(work, "account.zip");
  seeded = new SeedFiles(srcRoot);

  src = new Client({ connectionString: urlFor(decodeURIComponent(BASE_URL.pathname.slice(1))) });
  await src.connect();
  await cleanSeed(src);
  await seedCatalogue(src);
  await seedOtherAccount(src, seeded);
  await seedAccount(src, seeded);
  await seedCrossLinks(src);

  await recreateDatabase(TARGET_DB);
  migrate(TARGET_DB);
  dst = new Client({ connectionString: urlFor(TARGET_DB) });
  await dst.connect();
  dstPrisma = createPrismaClient({ url: urlFor(TARGET_DB) });
  // The target's own catalogue, under its own ids; it lacks the rail station.
  await dst.query(
    `INSERT INTO ports (id, name, lat, lon, unlocode) VALUES ($1, 'Kiel', 54.3, 10.1, 'DEKEL'), ($1 + 1, 'Oslo', 59.9, 10.7, 'NOOSL')`,
    [TARGET_PORT_ID]
  );
  await dst.query(
    `INSERT INTO airports (id, name, lat, lon, iata, icao) VALUES (5000, 'Frankfurt', 50, 8.5, 'ZZF', 'ZZZF')`
  );
  await dst.query(
    `INSERT INTO ships (id, name, cruise_line, imo) VALUES (5001, 'AZ Ship', 'AZ', '9999991')`
  );
  await dst.query(`INSERT INTO lodging_chains (id, name) VALUES (6000, 'AZ Catalogue Chain')`);
  await dst.query(
    `INSERT INTO achievements (id, code, name, description, category, icon, "requirementType", requirement)
     VALUES ('az-target-ach', 'AZ_FIRST', 'First', 'd', 'c', 'i', 'flights', 1)`
  );
  for (const id of [TARGET_USER, OTHER_TARGET_USER, SPARE_TARGET_USER]) {
    await dst.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [id]);
  }
  // The new account's own settings row, with a key of its own that must survive.
  await dst.query(
    `INSERT INTO user_settings (id, user_id, data, immich_api_key, updated_at) VALUES ('az-target-settings', $1, '{}', 'TARGET-OWN-KEY', now())`,
    [TARGET_USER]
  );
  await dst.query(
    `INSERT INTO flights (id, user_id, dep_lat, dep_lon, arr_lat, arr_lon) VALUES ('az-other-flight', $1, 1, 2, 3, 4)`,
    [OTHER_TARGET_USER]
  );

  plan = buildPlan(await readCatalog(dstPrisma as unknown as Db));
  await writeAccountArchive(U, zipPath, undefined, { uploadsRoot: srcRoot });
  importResult = await importAccountArchive(zipPath, TARGET_USER, undefined, {
    uploadsRoot: dstRoot,
    client: dstPrisma,
  });
});

afterAll(async () => {
  await cleanSeed(src).catch(() => {});
  await src?.end();
  await dst?.end();
  await dstPrisma?.$disconnect();
  await dropDatabase(TARGET_DB);
  fs.rmSync(work, { recursive: true, force: true });
});

describe("account archive round trip", () => {
  it("brings every row of every data table across, with the same count per table", async () => {
    const before = await counts(src, U);
    const after = await counts(dst, TARGET_USER);
    expect(after).toEqual(before);
    // The seed reaches every kind the brief names.
    for (const table of [
      "flights",
      "cruises",
      "cruise_stops",
      "cruise_legs",
      "lodgings",
      "lodging_stays",
      "rail_journeys",
      "bus_journeys",
      "ferry_journeys",
      "vessel_position_fixes",
      "rental_bookings",
      "trips",
      "places",
      "place_visits",
      "notes",
      "companions",
      "flight_companions",
      "trip_expenses",
      "receipt_uploads",
      "documents",
      "document_links",
      "trip_photos",
      "place_visit_photos",
      "lodging_photos",
      "travtrack_points",
      "travtrack_point_links",
      "travtrack_privacy_zones",
      "user_settings",
      "lodging_chains",
      "lodging_membership_chains",
      "user_achievements",
    ]) {
      expect(after[table]).toBeGreaterThan(0);
    }
    expect(importResult.alreadyImported).toBe(false);
  });

  it("restores every file with the same sha256, and every row names a file that exists", async () => {
    const restored = listFiles(dstRoot)
      .map((f) => sha(path.join(dstRoot, f)))
      .sort();
    expect(restored).toEqual([...seeded.files.values()].sort());
    const { rows: docs } = await dst.query(
      `SELECT stored_name, sha256 FROM documents WHERE user_id = $1`,
      [TARGET_USER]
    );
    for (const d of docs)
      expect(sha(path.join(dstRoot, "documents", d.stored_name))).toBe(d.sha256);
    const named: Array<[string, string]> = [
      [
        "trip-photos",
        `SELECT filename AS f FROM trip_photos WHERE immich_asset_id IS NULL AND trip_id IN (SELECT id FROM trips WHERE user_id = $1)`,
      ],
      [
        "place-photos",
        `SELECT filename AS f FROM place_visit_photos WHERE filename IS NOT NULL AND place_visit_id IN (SELECT id FROM place_visits WHERE user_id = $1)`,
      ],
      [
        "lodging-photos",
        `SELECT filename AS f FROM lodging_photos WHERE lodging_id IN (SELECT id FROM lodgings WHERE user_id = $1)`,
      ],
      ["note-photos", `SELECT photo_filename AS f FROM notes WHERE user_id = $1`],
      ["receipts", `SELECT filename AS f FROM receipt_uploads WHERE user_id = $1`],
    ];
    for (const [dir, sql] of named) {
      const { rows } = await dst.query(sql, [TARGET_USER]);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(fs.existsSync(path.join(dstRoot, dir, r.f))).toBe(true);
    }
    // A HEIC original keeps its display rendition beside it.
    const heic = await one<{ f: string }>(dst, named[0][1], [TARGET_USER]);
    expect(fs.existsSync(path.join(dstRoot, "trip-photos", `${heic.f}.display.jpg`))).toBe(true);
    // The avatar is renamed for its new owner, and the settings row names the new file.
    const settings = await one<{ data: { profile: { profilePicture: string } } }>(
      dst,
      `SELECT data FROM user_settings WHERE user_id = $1`,
      [TARGET_USER]
    );
    const avatar = /profile-picture\/([^/]+)\/content/.exec(
      settings.data.profile.profilePicture
    )![1];
    expect(avatar.startsWith(`${TARGET_USER}_`)).toBe(true);
    expect(fs.existsSync(path.join(dstRoot, "profile-pictures", avatar))).toBe(true);
  });

  it("keeps document links as they were: role, provenance, rental category, every target", async () => {
    const shape = async (client: Client, userId: string) => {
      const { rows } = await client.query(
        `SELECT d.original_name, l.role, l.provenance, l.rental_category,
                (SELECT string_agg(k, ',') FROM jsonb_each_text(to_jsonb(l)) e(k, v)
                  WHERE k LIKE '%\\_id' ESCAPE '\\' AND k NOT IN ('id', 'document_id') AND v IS NOT NULL) AS target
           FROM document_links l JOIN documents d ON d.id = l.document_id WHERE d.user_id = $1
          ORDER BY 1, 2, 5`,
        [userId]
      );
      return rows;
    };
    const before = await shape(src, U);
    expect(before.length).toBe(10);
    expect(await shape(dst, TARGET_USER)).toEqual(before);
    // Every link's target is a row of the new account.
    const { rows } = await dst.query(
      `SELECT l.flight_id, f.user_id FROM document_links l JOIN flights f ON f.id = l.flight_id
        JOIN documents d ON d.id = l.document_id WHERE d.user_id = $1`,
      [TARGET_USER]
    );
    expect(rows).toEqual([{ flight_id: expect.not.stringMatching(/^az-/), user_id: TARGET_USER }]);
  });

  it("re-keys every id, rewrites ids inside text and JSON, and closes the places/cover-photo cycle", async () => {
    const { rows } = await dst.query(`SELECT id FROM flights WHERE user_id = $1`, [TARGET_USER]);
    expect(rows.every((r) => !r.id.startsWith("az-"))).toBe(true);
    const cat = await one<{ id: string }>(
      dst,
      `SELECT id FROM place_categories WHERE user_id = $1`,
      [TARGET_USER]
    );
    const place = await one<{ category: string; cover_photo_id: string }>(
      dst,
      `SELECT category, cover_photo_id FROM places WHERE user_id = $1`,
      [TARGET_USER]
    );
    expect(place.category).toBe(`custom:${cat.id}`);
    const cover = await one<{ filename: string }>(
      dst,
      `SELECT filename FROM place_visit_photos WHERE id = $1`,
      [place.cover_photo_id]
    );
    expect(cover.filename).toMatch(/visit-1\.jpg$/);
    const note = await one<{ body: string }>(dst, `SELECT body FROM notes WHERE user_id = $1`, [
      TARGET_USER,
    ]);
    const trip = await one<{ id: string }>(dst, `SELECT id FROM trips WHERE user_id = $1`, [
      TARGET_USER,
    ]);
    expect(note.body).toBe(`a note about ${trip.id}`);
    const amount = await one<{ amount: string }>(
      dst,
      `SELECT amount::text FROM trip_expenses WHERE user_id = $1`,
      [TARGET_USER]
    );
    expect(amount.amount).toMatch(/^12\.3456/);
  });

  it("keeps TravTrack points in order and links them to the new entries", async () => {
    const { rows } = await dst.query(
      `SELECT t_s FROM travtrack_points WHERE user_id = $1 ORDER BY seq`,
      [TARGET_USER]
    );
    expect(rows.map((r) => r.t_s)).toEqual(Array.from({ length: POINTS }, (_, i) => i * 60));
    const link = await one<{ entry_id: string; t_s: number }>(
      dst,
      `SELECT l.entry_id, p.t_s FROM travtrack_point_links l JOIN travtrack_points p ON p.id = l.point_id WHERE l.user_id = $1`,
      [TARGET_USER]
    );
    const flight = await one<{ id: string }>(dst, `SELECT id FROM flights WHERE user_id = $1`, [
      TARGET_USER,
    ]);
    expect(link).toEqual({ entry_id: flight.id, t_s: 180 });
  });

  it("resolves catalogue references by natural key and never writes a catalogue row", async () => {
    const stop = await one<{ port_id: number }>(
      dst,
      `SELECT port_id FROM cruise_stops s JOIN cruises c ON c.id = s.cruise_id WHERE c.user_id = $1`,
      [TARGET_USER]
    );
    expect(stop.port_id).toBe(TARGET_PORT_ID);
    const leg = await one<{ to: number }>(
      dst,
      `SELECT l.to_port_id AS to FROM cruise_legs l JOIN cruises c ON c.id = l.cruise_id WHERE c.user_id = $1`,
      [TARGET_USER]
    );
    expect(leg.to).toBe(TARGET_PORT_ID + 1);
    const rental = await one(
      dst,
      `SELECT pickup_airport_id FROM rental_bookings WHERE user_id = $1`,
      [TARGET_USER]
    );
    expect(rental).toEqual({ pickup_airport_id: 5000 });
    // The target has no such station: the reference stays empty, and the result says so.
    const rail = await one(dst, `SELECT dep_station_id FROM rail_journeys WHERE user_id = $1`, [
      TARGET_USER,
    ]);
    expect(rail).toEqual({ dep_station_id: null });
    expect(importResult.unmatched).toBe(1);
    const { rows: chains } = await dst.query(
      `SELECT l.name AS lodging, c.id, c.name AS chain, c.user_id FROM lodgings l JOIN lodging_chains c ON c.id = l.chain_id WHERE l.user_id = $1 ORDER BY 1`,
      [TARGET_USER]
    );
    expect(chains).toEqual([
      { lodging: "Hotel", id: 6000, chain: "AZ Catalogue Chain", user_id: null },
      { lodging: "Inn", id: expect.any(Number), chain: "AZ Own Chain", user_id: TARGET_USER },
    ]);
    const { rows: memberChains } = await dst.query(
      `SELECT c.name FROM lodging_membership_chains m JOIN lodging_chains c ON c.id = m.chain_id
        JOIN loyalty_memberships lm ON lm.id = m.membership_id WHERE lm.user_id = $1 ORDER BY 1`,
      [TARGET_USER]
    );
    expect(memberChains.map((r) => r.name)).toEqual(["AZ Catalogue Chain", "AZ Own Chain"]);
    const ach = await one(dst, `SELECT achievement_id FROM user_achievements WHERE user_id = $1`, [
      TARGET_USER,
    ]);
    expect(ach).toEqual({ achievement_id: "az-target-ach" });
    const catalogue = await one(
      dst,
      `SELECT (SELECT count(*)::int FROM ports) AS ports, (SELECT count(*)::int FROM airports) AS airports,
              (SELECT count(*)::int FROM rail_stations) AS stations,
              (SELECT count(*)::int FROM lodging_chains WHERE user_id IS NULL) AS chains`
    );
    expect(catalogue).toEqual({ ports: 2, airports: 1, stations: 0, chains: 1 });
  });

  it("carries no credential, other account or share state, and keeps the target's own keys", async () => {
    const entries = await readZip(zipPath);
    const text = [...entries.values()].map((b) => b.toString("latin1")).join("\n");
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toContain("digest-should-not-travel");
    expect(text).not.toContain(FRIEND);
    expect(text).not.toContain("az-friend");
    expect([...entries.keys()].some((n) => n.startsWith("data/api_tokens"))).toBe(false);
    // Shares are written for the reader only.
    expect(entries.has("info/public_share_links.jsonl")).toBe(true);
    expect(await one(dst, `SELECT count(*)::int AS n FROM public_share_links`)).toEqual({ n: 0 });

    const settings = await one(
      dst,
      `SELECT immich_api_key, strava_access_token, immich_base_url FROM user_settings WHERE user_id = $1`,
      [TARGET_USER]
    );
    // The target's own Immich key keeps the target's own endpoint: an archive must not
    // point a key it never saw at a server of its choosing (codex review).
    expect(settings).toEqual({
      immich_api_key: "TARGET-OWN-KEY",
      strava_access_token: null,
      immich_base_url: null,
    });
    const flight = await one(dst, `SELECT share_key FROM flights WHERE user_id = $1`, [
      TARGET_USER,
    ]);
    expect(flight).toEqual({ share_key: null });
    const companion = await one(dst, `SELECT linked_user_id FROM companions WHERE user_id = $1`, [
      TARGET_USER,
    ]);
    expect(companion).toEqual({ linked_user_id: null });
    const profile = await one(dst, `SELECT first_name, password_hash FROM users WHERE id = $1`, [
      TARGET_USER,
    ]);
    expect(profile).toEqual({ first_name: "Ann", password_hash: "x" });
  });

  it("leaves other accounts untouched", async () => {
    expect(await counts(dst, OTHER_TARGET_USER)).toEqual({ flights: 1 });
    expect(await counts(dst, SPARE_TARGET_USER)).toEqual({});
  });

  it("answers a repeated import of the same archive with the first outcome", async () => {
    const again = await importAccountArchive(zipPath, TARGET_USER, undefined, {
      uploadsRoot: dstRoot,
      client: dstPrisma,
    });
    expect(again.alreadyImported).toBe(true);
    expect(again.tables).toEqual(importResult.tables);
    expect((await counts(dst, TARGET_USER)).flights).toBe(1);
  });

  it("refuses the same archive for another account", async () => {
    await expect(
      importAccountArchive(zipPath, SPARE_TARGET_USER, undefined, {
        uploadsRoot: dstRoot,
        client: dstPrisma,
      })
    ).rejects.toMatchObject({ code: "ACCOUNT_ARCHIVE_ALREADY_IMPORTED" });
  });

  it("refuses a target account that already holds data", async () => {
    const fresh = path.join(work, "fresh.zip");
    await writeAccountArchive(U, fresh, undefined, { uploadsRoot: srcRoot });
    await expect(
      importAccountArchive(fresh, OTHER_TARGET_USER, undefined, {
        uploadsRoot: dstRoot,
        client: dstPrisma,
      })
    ).rejects.toMatchObject({ code: "ACCOUNT_ARCHIVE_TARGET_NOT_EMPTY" });
  });

  it("refuses an archive from a newer format version", async () => {
    const entries = await readZip(zipPath);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString());
    entries.set(
      "manifest.json",
      Buffer.from(
        JSON.stringify({ ...manifest, formatVersion: 99, archiveId: crypto.randomUUID() })
      )
    );
    const newer = path.join(work, "newer.zip");
    await writeZip(newer, entries);
    await expect(
      importAccountArchive(newer, SPARE_TARGET_USER, undefined, {
        uploadsRoot: dstRoot,
        client: dstPrisma,
      })
    ).rejects.toMatchObject({ code: "ACCOUNT_ARCHIVE_FORMAT_TOO_NEW" });
  });

  it("refuses an entry whose bytes do not match the manifest, before writing anything", async () => {
    const entries = await readZip(zipPath);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString());
    entries.set(
      "manifest.json",
      Buffer.from(JSON.stringify({ ...manifest, archiveId: crypto.randomUUID() }))
    );
    const doc = [...entries.keys()].find((n) => n.startsWith("files/documents/"))!;
    const original = entries.get(doc)!;
    entries.set(doc, Buffer.from(original.toString().replace(/./, "X")));
    const tampered = path.join(work, "tampered.zip");
    await writeZip(tampered, entries);
    const filesBefore = listFiles(dstRoot);
    await expect(
      importAccountArchive(tampered, SPARE_TARGET_USER, undefined, {
        uploadsRoot: dstRoot,
        client: dstPrisma,
      })
    ).rejects.toMatchObject({ code: "ACCOUNT_ARCHIVE_CHECKSUM" });
    expect(listFiles(dstRoot)).toEqual(filesBefore);
  });

  it("leaves nothing behind when the import fails half-way", async () => {
    const entries = await readZip(zipPath);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString());
    entries.set(
      "manifest.json",
      Buffer.from(JSON.stringify({ ...manifest, archiveId: crypto.randomUUID() }))
    );
    const copy = path.join(work, "copy.zip");
    await writeZip(copy, entries);
    const filesBefore = listFiles(dstRoot);
    await expect(
      importAccountArchive(copy, SPARE_TARGET_USER, undefined, {
        uploadsRoot: dstRoot,
        client: dstPrisma,
        failAfterRows: 30,
      })
    ).rejects.toThrow("injected failure");
    expect(await counts(dst, SPARE_TARGET_USER)).toEqual({});
    expect(
      await one(dst, `SELECT count(*)::int AS n FROM account_archive_imports WHERE user_id = $1`, [
        SPARE_TARGET_USER,
      ])
    ).toEqual({ n: 0 });
    expect(listFiles(dstRoot)).toEqual(filesBefore);
  });

  it("refuses an archive naming a table this server does not have", async () => {
    const entries = await readZip(zipPath);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString());
    const renamed = manifest.entries.map((e: { name: string }) =>
      e.name === "data/notes.jsonl" ? { ...e, name: "data/hovercraft_journeys.jsonl" } : e
    );
    entries.set("data/hovercraft_journeys.jsonl", entries.get("data/notes.jsonl")!);
    entries.delete("data/notes.jsonl");
    entries.set(
      "manifest.json",
      Buffer.from(JSON.stringify({ ...manifest, entries: renamed, archiveId: crypto.randomUUID() }))
    );
    const newer = path.join(work, "schema.zip");
    await writeZip(newer, entries);
    await expect(
      importAccountArchive(newer, SPARE_TARGET_USER, undefined, {
        uploadsRoot: dstRoot,
        client: dstPrisma,
      })
    ).rejects.toMatchObject({ code: "ACCOUNT_ARCHIVE_SCHEMA_TOO_NEW" });
  });

  it("imports next to the source account on the same server without touching it", async () => {
    const before = await counts(src, U);
    const friendBefore = await counts(src, FRIEND);
    await src.query(
      `INSERT INTO users (id, username, password_hash) VALUES ('az-user-copy', 'az-user-copy', 'x')`
    );
    const sameRoot = path.join(work, "same-uploads");
    fs.cpSync(srcRoot, sameRoot, { recursive: true });
    const sameZip = path.join(work, "same.zip");
    await writeAccountArchive(U, sameZip, undefined, { uploadsRoot: sameRoot });
    await importAccountArchive(sameZip, "az-user-copy", undefined, { uploadsRoot: sameRoot });
    expect(await counts(src, U)).toEqual(before);
    expect(await counts(src, FRIEND)).toEqual(friendBefore);
    expect(await counts(src, "az-user-copy")).toEqual(before);
    // The source's files are still there, byte for byte.
    for (const [rel, digest] of seeded.files) expect(sha(path.join(sameRoot, rel))).toBe(digest);
    const port = await one<{ n: number }>(
      src,
      `SELECT count(*)::int AS n FROM ports WHERE unlocode = 'DEKEL'`
    );
    expect(port.n).toBe(1);
    expect(CATALOGUE.port).toBeGreaterThan(0);
  });

  it("never creates or changes a shared catalogue row, whatever the archive says", async () => {
    const poisoned = await repack((entries) => {
      // An owned chain made owner-less would become every account's catalogue chain.
      editLines(entries, "data/lodging_chains.jsonl", (r) => ({
        ...r,
        user_id: null,
        name: "AZ Poison",
      }));
      editLines(entries, "catalogue/ports.jsonl", (r) => ({ ...r, name: "Poisoned" }));
      editLines(entries, "catalogue/rail_stations.jsonl", (r) => ({ ...r, name: "Injected" }));
    }, "poison.zip");
    const user = await freshUser("az-target-poison");
    await importAccountArchive(poisoned, user, undefined, {
      uploadsRoot: dstRoot,
      client: dstPrisma,
    });
    const { rows } = await dst.query(`SELECT user_id FROM lodging_chains WHERE name = 'AZ Poison'`);
    expect(rows).toEqual([{ user_id: user }]);
    expect(await one(dst, `SELECT name FROM ports WHERE id = $1`, [TARGET_PORT_ID])).toEqual({
      name: "Kiel",
    });
    expect(await one(dst, `SELECT count(*)::int AS n FROM rail_stations`)).toEqual({ n: 0 });
    expect(await one(dst, `SELECT count(*)::int AS n FROM ports WHERE name = 'Poisoned'`)).toEqual({
      n: 0,
    });
  });

  it("refuses a file the upload path would not accept, and the rows that need it", async () => {
    let storedName = "";
    const html = await repack((entries) => {
      const entry = [...entries.keys()].find(
        (n) => n.startsWith("files/documents/") && n.includes("doc-trip")
      )!;
      storedName = entry.slice("files/documents/".length);
      entries.set(entry, Buffer.from("<html><script>alert(1)</script></html>"));
      editLines(entries, "data/documents.jsonl", (r) =>
        r.stored_name === storedName ? { ...r, mimetype: "text/html" } : r
      );
    }, "html.zip");
    const user = await freshUser("az-target-html");
    const result = await importAccountArchive(html, user, undefined, {
      uploadsRoot: dstRoot,
      client: dstPrisma,
    });
    expect(result.refusedFiles).toBe(1);
    expect(result.skipped.documents).toBe(1);
    const docs = await dst.query(
      `SELECT original_name, mimetype FROM documents WHERE user_id = $1`,
      [user]
    );
    expect(docs.rows.length).toBe(importResult.tables.documents - 1);
    expect(docs.rows.every((d) => d.mimetype === "application/pdf")).toBe(true);
    expect(docs.rows.some((d) => d.original_name.includes("trip-0001"))).toBe(false);
    // Its four links went with it; the others are intact.
    const links = await one<{ n: number }>(
      dst,
      `SELECT count(*)::int AS n FROM document_links l JOIN documents d ON d.id = l.document_id WHERE d.user_id = $1`,
      [user]
    );
    expect(links.n).toBe(6);
    for (const f of listFiles(dstRoot)) {
      expect(fs.readFileSync(path.join(dstRoot, f)).toString()).not.toContain("<script>");
    }
  });

  it("refuses a row whose user column names another account", async () => {
    const forged = await repack((entries) => {
      editLines(entries, "data/flights.jsonl", (r) => ({ ...r, user_id: OTHER_TARGET_USER }));
    }, "forged.zip");
    const user = await freshUser("az-target-forged");
    await importAccountArchive(forged, user, undefined, {
      uploadsRoot: dstRoot,
      client: dstPrisma,
    });
    expect(await counts(dst, OTHER_TARGET_USER)).toEqual({ flights: 1 });
    expect((await counts(dst, user)).flights).toBe(1);
  });

  it("does not export another account's file that a row of this account names", async () => {
    await src.query(
      `UPDATE documents SET stored_name = 'az-friend-doc.pdf' WHERE id = 'az-doc-unfiled-0001'`
    );
    try {
      const leak = path.join(work, "leak.zip");
      const result = await writeAccountArchive(U, leak, undefined, { uploadsRoot: srcRoot });
      const entries = await readZip(leak);
      expect(entries.has("files/documents/az-friend-doc.pdf")).toBe(false);
      for (const bytes of entries.values())
        expect(bytes.toString("latin1")).not.toContain("friend bytes");
      expect(result.missingFiles).toBeGreaterThanOrEqual(0);
    } finally {
      await src.query(
        `UPDATE documents SET stored_name = 'az-doc-unfiled-0001.pdf' WHERE id = 'az-doc-unfiled-0001'`
      );
    }
  });

  it("refuses an export larger than the ceiling, counting the files it writes", async () => {
    await expect(
      writeAccountArchive(U, path.join(work, "big.zip"), undefined, {
        uploadsRoot: srcRoot,
        maxBytes: 64,
      })
    ).rejects.toMatchObject({ code: "ACCOUNT_ARCHIVE_TOO_LARGE" });
    expect(fs.existsSync(path.join(work, "big.zip"))).toBe(false);
  });

  it("keeps a package's price split valid: it is written after its members", async () => {
    const booking = await one<{ price_split: { stale?: boolean; shares: Record<string, number> } }>(
      dst,
      `SELECT price_split FROM bookings WHERE user_id = $1`,
      [TARGET_USER]
    );
    const flight = await one<{ id: string }>(dst, `SELECT id FROM flights WHERE user_id = $1`, [
      TARGET_USER,
    ]);
    const source = await one<{ stale: boolean | null }>(
      src,
      `SELECT (price_split->>'stale')::boolean AS stale FROM bookings WHERE id = 'az-booking-0001'`
    );
    expect(source.stale).toBeNull();
    expect(booking.price_split.stale).toBeUndefined();
    expect(booking.price_split.shares).toEqual({ [flight.id]: 500 });
  });

  it("exports only files the account provably owns: no encoded or query-string foreign receipt, no orphan, no pending deletion", async () => {
    await src.query(
      `UPDATE flights SET receipt_url = '/api/v1/uploads/receipts/az%2Dfriend%2Dreceipt.pdf' WHERE id = 'az-flight-0001'`
    );
    await src.query(
      `UPDATE lodging_stays SET receipt_url = '/api/v1/uploads/receipts/az-friend-receipt.pdf?download=1#x' WHERE id = 'az-stay-0001'`
    );
    const orphans = [
      path.join(srcRoot, "documents", "az-orphan.pdf"),
      path.join(srcRoot, "profile-pictures", `${U}_old.png`),
    ];
    for (const f of orphans) fs.writeFileSync(f, "orphan bytes");
    try {
      const first = path.join(work, "owned.zip");
      await writeAccountArchive(U, first, undefined, { uploadsRoot: srcRoot });
      const entries = await readZip(first);
      expect(entries.has("files/receipts/receipt-1.pdf")).toBe(true);
      expect(entries.has("files/documents/az-doc-trip-0001.pdf")).toBe(true);
      expect(entries.has("files/receipts/az-friend-receipt.pdf")).toBe(false);
      expect(entries.has("files/documents/az-orphan.pdf")).toBe(false);
      expect(entries.has(`files/profile-pictures/${U}_old.png`)).toBe(false);
      for (const bytes of entries.values()) {
        expect(bytes.toString("latin1")).not.toContain("friend receipt");
        expect(bytes.toString("latin1")).not.toContain("orphan bytes");
      }

      await recordPendingDeletions(srcRoot, [
        { dir: "receipts", storedName: "receipt-1.pdf", userId: U },
      ]);
      const second = path.join(work, "pending.zip");
      await writeAccountArchive(U, second, undefined, { uploadsRoot: srcRoot });
      expect((await readZip(second)).has("files/receipts/receipt-1.pdf")).toBe(false);
    } finally {
      await src.query(`UPDATE flights SET receipt_url = NULL WHERE id = 'az-flight-0001'`);
      await src.query(`UPDATE lodging_stays SET receipt_url = NULL WHERE id = 'az-stay-0001'`);
      for (const f of orphans) fs.rmSync(f, { force: true });
      fs.rmSync(path.join(srcRoot, ".pending-deletions.json"), { force: true });
    }
  });

  it("an EXTERNAL receipt URL of another account with the same basename does not drop an owned receipt, and a real claim is listed as left out", async () => {
    try {
      await src.query(
        `UPDATE flights SET receipt_url = 'https://evil.example/files/receipt-1.pdf' WHERE id = 'az-friend-flight'`
      );
      const ext = path.join(work, "external.zip");
      const result = await writeAccountArchive(U, ext, undefined, { uploadsRoot: srcRoot });
      expect((await readZip(ext)).has("files/receipts/receipt-1.pdf")).toBe(true);
      expect(result.omittedFiles.some((o) => o.name === "receipt-1.pdf")).toBe(false);

      await src.query(
        `UPDATE flights SET receipt_url = '/api/v1/uploads/receipts/receipt-1.pdf' WHERE id = 'az-friend-flight'`
      );
      const local = path.join(work, "local-claim.zip");
      const claimed = await writeAccountArchive(U, local, undefined, { uploadsRoot: srcRoot });
      expect((await readZip(local)).has("files/receipts/receipt-1.pdf")).toBe(false);
      expect(claimed.omittedFiles).toContainEqual({
        dir: "receipts",
        name: "receipt-1.pdf",
        reason: "not_owned",
      });
      expect(claimed.missingFiles).toBeGreaterThanOrEqual(1);
    } finally {
      await src.query(`UPDATE flights SET receipt_url = NULL WHERE id = 'az-friend-flight'`);
    }
  });
});
