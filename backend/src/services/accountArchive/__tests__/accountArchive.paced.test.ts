/**
 * Perf audit 2026-11, item 5: the account-archive restore ran in ONE
 * interactive transaction of up to six hours, unpaced and outside the import
 * write slot: the pattern that made prod unusable during the 24.11 import. It
 * now commits per batch, pauses after each, takes the write slot, and undoes
 * itself by compensation (or on the next attempt, after a crash).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "pg";

import { prisma } from "../../../db";
import type { PrismaClient } from "../../../prisma";
import { FairSlot } from "../../travtrack/imports/writeSlot";
import { readCatalog, type Db } from "../catalog";
import { writeAccountArchive } from "../exportArchive";
import { importAccountArchive } from "../importArchive";
import { buildPlan, selectionWhere, type ArchivePlan } from "../plan";
import { BASE_URL, readZip, urlFor } from "./archiveHelpers";
import {
  cleanSeed,
  SeedFiles,
  seedAccount,
  seedCatalogue,
  seedCrossLinks,
  seedOtherAccount,
  U,
} from "./archiveSeed";

jest.setTimeout(120_000);

const USERS = ["az-paced-1", "az-paced-2", "az-paced-3", "az-paced-4", "az-paced-5"];
let work: string;
let root: string;
let zipPath: string;
let archiveId: string;
let db: Client;
let plan: ArchivePlan;
const client = prisma as unknown as PrismaClient;

async function counts(userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const p of plan.tables) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM "${p.table.name}" t0 WHERE ${selectionWhere(plan, p.table.name)}`,
      [userId]
    );
    if (rows[0].n > 0) out[p.table.name] = rows[0].n;
  }
  return out;
}

const noSleep = async () => {};

beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "az-paced-"));
  root = path.join(work, "uploads");
  zipPath = path.join(work, "account.zip");
  const seeded = new SeedFiles(root);
  db = new Client({ connectionString: urlFor(decodeURIComponent(BASE_URL.pathname.slice(1))) });
  await db.connect();
  await cleanSeed(db);
  await seedCatalogue(db);
  await seedOtherAccount(db, seeded);
  await seedAccount(db, seeded);
  await seedCrossLinks(db);
  for (const id of USERS) {
    await db.query(`DELETE FROM users WHERE id = $1`, [id]);
    await db.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [id]);
  }
  plan = buildPlan(await readCatalog(client as unknown as Db));
  await writeAccountArchive(U, zipPath, undefined, { uploadsRoot: root });
  const manifest = JSON.parse((await readZip(zipPath)).get("manifest.json")!.toString());
  archiveId = manifest.archiveId;
});

afterAll(async () => {
  await db.query(`DELETE FROM users WHERE id = ANY($1)`, [USERS]);
  await cleanSeed(db).catch(() => {});
  await db.end();
  fs.rmSync(work, { recursive: true, force: true });
});

afterEach(async () => {
  await db.query(`DELETE FROM account_archive_imports WHERE archive_id = $1`, [archiveId]);
});

describe("the paced account-archive restore", () => {
  it("commits each batch on its own and pauses after it", async () => {
    const visibleDuringPauses: number[] = [];
    const result = await importAccountArchive(zipPath, USERS[0], undefined, {
      uploadsRoot: root,
      sleep: async () => {
        // Another connection sees the rows already: no transaction holds them.
        const { rows } = await db.query(
          `SELECT count(*)::int AS n FROM flights WHERE user_id = $1`,
          [USERS[0]]
        );
        visibleDuringPauses.push(rows[0].n);
      },
    });
    expect(result.alreadyImported).toBe(false);
    expect(visibleDuringPauses.length).toBeGreaterThan(3);
    expect(Math.max(...visibleDuringPauses)).toBeGreaterThan(0);
    expect(await counts(USERS[0])).toEqual(await counts(U));
    await db.query(`DELETE FROM flights WHERE user_id = $1`, [USERS[0]]);
  });

  it("waits for the import write slot while a file import holds it", async () => {
    const slot = new FairSlot(1);
    await slot.acquire("someone-importing");
    let settled = false;
    const run = importAccountArchive(zipPath, USERS[1], undefined, {
      uploadsRoot: root,
      slot,
      sleep: noSleep,
    }).finally(() => (settled = true));
    await new Promise((r) => setTimeout(r, 500));
    expect(settled).toBe(false);
    expect(slot.waiting()).toBe(1);
    expect(await counts(USERS[1])).toEqual({});
    slot.release();
    await expect(run).resolves.toMatchObject({ alreadyImported: false });
  });

  it("undoes a restore a crash interrupted, then runs it again", async () => {
    // What a crash half-way leaves: the marker in progress and some rows.
    await db.query(
      `INSERT INTO account_archive_imports (id, archive_id, user_id, source_server_version, format_version, counts)
       VALUES ('az-paced-marker', $1, $2, 'x', 1, '{"inProgress": true}')`,
      [archiveId, USERS[2]]
    );
    await db.query(
      `INSERT INTO flights (id, user_id, dep_lat, dep_lon, arr_lat, arr_lon) VALUES ('az-paced-stray', $1, 1, 2, 3, 4)`,
      [USERS[2]]
    );
    const result = await importAccountArchive(zipPath, USERS[2], undefined, {
      uploadsRoot: root,
      sleep: noSleep,
    });
    expect(result.alreadyImported).toBe(false);
    expect(await counts(USERS[2])).toEqual(await counts(U));
    const { rows } = await db.query(`SELECT 1 FROM flights WHERE id = 'az-paced-stray'`);
    expect(rows).toEqual([]);
  });

  it("refuses an account that gained data while waiting, and deletes none of it", async () => {
    const slot = new FairSlot(1);
    await slot.acquire("someone-importing");
    const run = importAccountArchive(zipPath, USERS[3], undefined, {
      uploadsRoot: root,
      slot,
      sleep: noSleep,
    });
    await new Promise((r) => setTimeout(r, 300));
    await db.query(
      `INSERT INTO flights (id, user_id, dep_lat, dep_lon, arr_lat, arr_lon) VALUES ('az-paced-own', $1, 1, 2, 3, 4)`,
      [USERS[3]]
    );
    slot.release();
    await expect(run).rejects.toMatchObject({ code: "ACCOUNT_ARCHIVE_TARGET_NOT_EMPTY" });
    const { rows } = await db.query(`SELECT 1 FROM flights WHERE id = 'az-paced-own'`);
    expect(rows).toHaveLength(1);
  });

  it("puts the account's own settings row back when a restore fails half-way", async () => {
    await db.query(
      `INSERT INTO user_settings (id, user_id, data, immich_api_key, updated_at) VALUES ('az-paced-settings', $1, '{}', 'OWN-KEY', now())`,
      [USERS[4]]
    );
    await expect(
      importAccountArchive(zipPath, USERS[4], undefined, {
        uploadsRoot: root,
        sleep: noSleep,
        failAfterRows: 30,
      })
    ).rejects.toThrow("injected failure");
    const { rows } = await db.query(`SELECT immich_api_key FROM user_settings WHERE user_id = $1`, [
      USERS[4],
    ]);
    expect(rows).toEqual([{ immich_api_key: "OWN-KEY" }]);
    expect(await counts(USERS[4])).toEqual({ user_settings: 1 });
  });
});
