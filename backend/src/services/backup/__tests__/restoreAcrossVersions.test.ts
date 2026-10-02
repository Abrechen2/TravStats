import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { prisma } from "../../../db";
import { healthHandler } from "../../../routes/health";
import { CLEAN_SCHEMA_PREAMBLE, feedPsql } from "../backupRestore";
import { missingSyncTriggers, runSyncSchemaCheck } from "../../sync/schemaCheck";

/**
 * forgejo#157 — restoring an archive written by an older version.
 *
 * Measured on 2026-10-02 with the real images: a beta.17 archive restored onto
 * beta.18 made psql stop at the first error while the dump was still being
 * piped in; the EPIPE that followed had no handler and killed the backend, so
 * the job vanished and the admin never heard that the restore had failed. An
 * archive that did restore left the sync feed's triggers behind and nobody
 * noticed. The full round trip (dump, psql, migrate) was re-measured against
 * the built image; these tests pin the three pieces a unit can hold.
 */

function bigDump(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "restore-")), "database.sql");
  // Far more than a pipe buffer, so the writer is still writing when the
  // reader has gone — the exact shape of the crash.
  fs.writeFileSync(file, "SELECT 1;\n".repeat(400_000));
  return file;
}

describe("feedPsql", () => {
  it("rejects with the reader's own complaint when it stops early, and the process survives", async () => {
    const dump = bigDump();
    // Stands in for psql under ON_ERROR_STOP: reads a little, complains, exits.
    const quitter = [
      "-e",
      "process.stdin.once('data', () => { process.stderr.write('ERROR:  cannot drop constraint users_pkey\\n'); process.exit(3); });",
    ];

    await expect(
      feedPsql(process.execPath, quitter, process.env, dump, CLEAN_SCHEMA_PREAMBLE)
    ).rejects.toThrow(/exited with code 3: ERROR: {2}cannot drop constraint users_pkey/);
  });

  it("sends the clean-schema preamble ahead of the dump, and resolves on success", async () => {
    const dump = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "restore-")), "database.sql");
    fs.writeFileSync(dump, "-- the dump\nSELECT 1;\n");
    const out = path.join(path.dirname(dump), "received.sql");
    // Stands in for a psql that reads everything and succeeds.
    const recorder = [
      "-e",
      `const fs = require("fs"); const chunks = []; process.stdin.on("data", (c) => chunks.push(c)); process.stdin.on("end", () => { fs.writeFileSync(${JSON.stringify(out)}, Buffer.concat(chunks)); });`,
    ];

    await feedPsql(process.execPath, recorder, process.env, dump, CLEAN_SCHEMA_PREAMBLE);

    const received = fs.readFileSync(out, "utf-8");
    expect(
      received.startsWith("DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n")
    ).toBe(true);
    expect(received.endsWith("-- the dump\nSELECT 1;\n")).toBe(true);
  });
});

describe("sync schema check", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  function health(): Record<string, unknown> {
    let body: Record<string, unknown> = {};
    healthHandler(
      {} as never,
      { json: (value: Record<string, unknown>) => (body = value) } as never
    );
    return body;
  }

  it("finds every trigger on a migrated database and reports the check as ok", async () => {
    expect(await missingSyncTriggers()).toEqual([]);
    expect(await runSyncSchemaCheck()).toEqual({ ok: true });
    expect(health()).toMatchObject({ checks: { syncTriggers: "ok" } });
  });

  it("names a missing trigger and turns /health degraded", async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER "AA_sync_change" ON "flights"`);
    try {
      expect(await missingSyncTriggers()).toEqual(["flights:AA_sync_change"]);
      expect(await runSyncSchemaCheck()).toEqual({
        ok: false,
        missing: ["flights:AA_sync_change"],
      });
      expect(health()).toMatchObject({ status: "degraded", checks: { syncTriggers: "failed" } });
    } finally {
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "flights"
           FOR EACH ROW EXECUTE FUNCTION sync_record_change('flight', '')`
      );
      await runSyncSchemaCheck();
    }
  });
});
