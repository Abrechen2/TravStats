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
  // The target already knows Kiel, under its own id.
  await dst.query(
    `INSERT INTO ports (id, name, lat, lon, unlocode) VALUES ($1, 'Kiel', 54.3, 10.1, 'DEKEL')`,
    [TARGET_PORT_ID]
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

  it("resolves catalogue references by natural key, copying only what the target lacks", async () => {
    const stop = await one<{ port_id: number }>(
      dst,
      `SELECT port_id FROM cruise_stops s JOIN cruises c ON c.id = s.cruise_id WHERE c.user_id = $1`,
      [TARGET_USER]
    );
    expect(stop.port_id).toBe(TARGET_PORT_ID);
    const leg = await one<{ to: string }>(
      dst,
      `SELECT p.unlocode AS to FROM cruise_legs l JOIN ports p ON p.id = l.to_port_id JOIN cruises c ON c.id = l.cruise_id WHERE c.user_id = $1`,
      [TARGET_USER]
    );
    expect(leg.to).toBe("NOOSL");
    const rental = await one<{ iata: string }>(
      dst,
      `SELECT a.iata FROM rental_bookings r JOIN airports a ON a.id = r.pickup_airport_id WHERE r.user_id = $1`,
      [TARGET_USER]
    );
    expect(rental.iata).toBe("ZZF");
    const rail = await one<{ source_id: string }>(
      dst,
      `SELECT s.source_id FROM rail_journeys r JOIN rail_stations s ON s.id = r.dep_station_id WHERE r.user_id = $1`,
      [TARGET_USER]
    );
    expect(rail.source_id).toBe("az-src-hh");
    const { rows: chains } = await dst.query(
      `SELECT l.name AS lodging, c.name AS chain, c.user_id FROM lodgings l JOIN lodging_chains c ON c.id = l.chain_id WHERE l.user_id = $1 ORDER BY 1`,
      [TARGET_USER]
    );
    expect(chains).toEqual([
      { lodging: "Hotel", chain: "AZ Catalogue Chain", user_id: null },
      { lodging: "Inn", chain: "AZ Own Chain", user_id: TARGET_USER },
    ]);
    const { rows: memberChains } = await dst.query(
      `SELECT c.name FROM lodging_membership_chains m JOIN lodging_chains c ON c.id = m.chain_id
        JOIN loyalty_memberships lm ON lm.id = m.membership_id WHERE lm.user_id = $1 ORDER BY 1`,
      [TARGET_USER]
    );
    expect(memberChains.map((r) => r.name)).toEqual(["AZ Catalogue Chain", "AZ Own Chain"]);
    const ach = await one<{ code: string }>(
      dst,
      `SELECT a.code FROM user_achievements u JOIN achievements a ON a.id = u.achievement_id WHERE u.user_id = $1`,
      [TARGET_USER]
    );
    expect(ach.code).toBe("AZ_FIRST");
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
    expect(settings).toEqual({
      immich_api_key: "TARGET-OWN-KEY",
      strava_access_token: null,
      immich_base_url: "https://immich.example",
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
});
