import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { prisma } from "../../../db";
import { healthHandler } from "../../../routes/health";
import { CLEAN_SCHEMA_PREAMBLE, feedPsql, keepRestoredBackupUsable } from "../backupRestore";
import { reconcileInterruptedBackups } from "../reconcileBackups";
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

describe("the clean-schema preamble", () => {
  it("leaves public owned by pg_database_owner with USAGE for PUBLIC, as PostgreSQL creates it", async () => {
    // Inside a transaction that is always rolled back: the preamble drops the
    // whole schema, and only the shape it leaves behind is under test.
    const ROLLBACK = new Error("rollback");
    let shape: { owner: string; acl: string | null } | undefined;
    await expect(
      prisma.$transaction(async (tx) => {
        for (const statement of CLEAN_SCHEMA_PREAMBLE.split("\n").filter(Boolean)) {
          await tx.$executeRawUnsafe(statement);
        }
        const [row] = await tx.$queryRaw<Array<{ owner: string; acl: string | null }>>`
          SELECT pg_get_userbyid(nspowner) AS owner, nspacl::text AS acl
          FROM pg_namespace WHERE nspname = 'public'`;
        shape = row;
        throw ROLLBACK;
      })
    ).rejects.toBe(ROLLBACK);

    expect(shape?.owner).toBe("pg_database_owner");
    expect(shape?.acl).toContain("=U/");
    expect(await missingSyncTriggers()).toEqual([]);
  });
});

describe("keepRestoredBackupUsable", () => {
  afterEach(async () => {
    await prisma.backup.deleteMany({ where: { backupPath: { startsWith: "/tmp/restore-test-" } } });
  });

  it("puts the restored archive's own row back to completed after the reconcile failed it", async () => {
    const before = await prisma.backup.create({
      data: {
        status: "completed",
        backupPath: "/tmp/restore-test-a.tar.gz",
        size: BigInt(1234),
        completedAt: new Date("2026-10-02T17:00:00Z"),
        metadata: { flights: 1 },
      },
    });
    // What the archive brings: its own row as it was while being written.
    await prisma.backup.update({ where: { id: before.id }, data: { status: "running" } });
    await reconcileInterruptedBackups("restore of backup test");
    expect((await prisma.backup.findUniqueOrThrow({ where: { id: before.id } })).status).toBe(
      "failed"
    );

    await keepRestoredBackupUsable(before);

    const after = await prisma.backup.findUniqueOrThrow({ where: { id: before.id } });
    expect(after).toMatchObject({
      status: "completed",
      errorMessage: null,
      size: BigInt(1234),
      metadata: { flights: 1 },
    });
  });

  it("recreates the row when the archive did not carry it at all", async () => {
    const before = await prisma.backup.create({
      data: { status: "completed", backupPath: "/tmp/restore-test-b.tar.gz" },
    });
    await prisma.backup.delete({ where: { id: before.id } });

    await keepRestoredBackupUsable(before);

    expect((await prisma.backup.findUniqueOrThrow({ where: { id: before.id } })).status).toBe(
      "completed"
    );
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
