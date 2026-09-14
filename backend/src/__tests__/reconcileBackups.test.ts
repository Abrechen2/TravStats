import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";

import { prisma } from "../db";
import { reconcileInterruptedBackups } from "../services/backup/reconcileBackups";

/**
 * AUD-069. A backup dumps the database while its own row still says `running`,
 * so the archive carries that row; restoring it puts `running` back. That state
 * is also the lock — `POST /backup`, `POST /backup/:id/restore` and the nightly
 * scheduler all refuse or skip while a `running` row exists — so a successful
 * restore silently ended every future backup.
 *
 * Deliberately against the real database rather than a mocked `updateMany`: the
 * property worth holding is that the LOCK QUERY finds nothing afterwards, and a
 * mock would only prove that a call was made. The lock query used here is the
 * same `findFirst({ where: { status: 'running' } })` the routes and the
 * scheduler run.
 */
describe("reconcileInterruptedBackups", () => {
  const PREFIX = "/tmp/reconcile-backups-test-";

  /** The exact query that guards POST /backup and POST /backup/:id/restore. */
  const lockQuery = () => prisma.backup.findFirst({ where: { status: "running" } });

  async function wipe() {
    await prisma.backup.deleteMany({ where: { backupPath: { startsWith: PREFIX } } });
  }

  beforeEach(async () => {
    await wipe();
    // Any row left by another test would make the lock query ambiguous.
    const stray = await lockQuery();
    if (stray) throw new Error(`another test left a running backup: ${stray.id}`);
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it("releases the lock a restored snapshot brought back", async () => {
    // What the archive carries: the row of the backup that took the dump,
    // frozen mid-flight.
    const restored = await prisma.backup.create({
      data: {
        status: "running",
        backupPath: `${PREFIX}restored.tar.gz`,
        startedAt: new Date("2026-09-01T02:00:00Z"),
      },
    });

    // The bug, stated as the guard sees it: a further backup would 409.
    expect(await lockQuery()).not.toBeNull();

    const count = await reconcileInterruptedBackups("restore of backup abc");

    expect(count).toBe(1);
    expect(await lockQuery()).toBeNull();

    const after = await prisma.backup.findUniqueOrThrow({ where: { id: restored.id } });
    expect(after.status).toBe("failed");
    // The row says what happened to it, rather than failing anonymously.
    expect(after.errorMessage).toBe("Interrupted: restore of backup abc");
    expect(after.completedAt).not.toBeNull();
  });

  it("also clears a pending row, which locks just as hard", async () => {
    await prisma.backup.create({
      data: { status: "pending", backupPath: `${PREFIX}pending.tar.gz` },
    });

    expect(await reconcileInterruptedBackups("server restart")).toBe(1);

    const rows = await prisma.backup.findMany({
      where: { backupPath: { startsWith: PREFIX } },
    });
    expect(rows.map((r) => r.status)).toEqual(["failed"]);
  });

  it("leaves finished rows alone", async () => {
    const done = await prisma.backup.create({
      data: {
        status: "completed",
        backupPath: `${PREFIX}done.tar.gz`,
        completedAt: new Date("2026-09-01T02:05:00Z"),
        size: BigInt(4096),
      },
    });
    const failed = await prisma.backup.create({
      data: {
        status: "failed",
        backupPath: `${PREFIX}failed.tar.gz`,
        errorMessage: "pg_dump exited 1",
      },
    });

    expect(await reconcileInterruptedBackups("server restart")).toBe(0);

    const doneAfter = await prisma.backup.findUniqueOrThrow({ where: { id: done.id } });
    const failedAfter = await prisma.backup.findUniqueOrThrow({ where: { id: failed.id } });
    expect(doneAfter.status).toBe("completed");
    expect(failedAfter.status).toBe("failed");
    // An earlier, real failure keeps its own cause instead of being overwritten.
    expect(failedAfter.errorMessage).toBe("pg_dump exited 1");
  });

  it("is a no-op when nothing is in flight", async () => {
    expect(await reconcileInterruptedBackups("server restart")).toBe(0);
    expect(await lockQuery()).toBeNull();
  });
});
