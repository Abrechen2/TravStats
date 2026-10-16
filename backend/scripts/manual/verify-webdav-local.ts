/** Run with tsx against a disposable localhost database ending in `_test`.
 * Uses the real WebDAV package, real HTTP and real files; no production access.
 * The backup table must be empty because retention is instance-wide.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "local test database required"
  );
  assert(url.pathname.endsWith("_test"), "database name must end in _test");
  const dir = mkdtempSync(join(tmpdir(), "travstats-webdav-local-"));
  process.env.BACKUP_PATH = dir;
  const { prisma } = await import("../../src/db");
  const { syncToCloud } = await import("../../src/services/cloudSyncService");
  const { deleteBackup, cleanupOldBackups } = await import("../../src/services/backupService");
  const { updateWebDAVSettings } = await import("../../src/services/instanceSettingsService");
  const objects = new Map<string, Buffer>();
  const requests: Array<{ method: string; path: string }> = [];
  let deleteStatus = 0;
  let uploadStatus = 0;
  let loseDeleteResponse = false;
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url!, "http://localhost").pathname);
    requests.push({ method: req.method!, path });
    if (req.method === "MKCOL") {
      res.writeHead(201).end();
      return;
    }
    if (req.method === "PROPFIND") {
      res.writeHead(404).end();
      return;
    }
    if (req.method === "PUT") {
      if (uploadStatus) {
        res.writeHead(uploadStatus).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(path, Buffer.concat(chunks));
      res.writeHead(201).end();
      return;
    }
    if (req.method === "DELETE") {
      if (deleteStatus) {
        res.writeHead(deleteStatus).end();
        return;
      }
      const existed = objects.delete(path);
      if (loseDeleteResponse) {
        loseDeleteResponse = false;
        req.socket.destroy();
        return;
      }
      res.writeHead(existed ? 204 : 404).end();
      return;
    }
    res.writeHead(405).end();
  });
  const ids: string[] = [];
  let previous: Awaited<ReturnType<typeof prisma.adminSettings.findFirst>> = null;
  let configured = false;
  let cases = 0;
  const passed = (name: string) => {
    cases++;
    console.log(`PASS ${name}`);
  };
  try {
    assert.equal(await prisma.backup.count(), 0, "refusing a database with existing backups");
    previous = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    configured = true;
    await updateWebDAVSettings({
      enabled: true,
      url: `http://127.0.0.1:${port}`,
      username: "local-test",
      password: "synthetic-local-only",
      backupPath: "/backups/",
    });
    const make = async (ageDays = 0) => {
      const name = `backup-local-${ids.length}.tar.gz`;
      const folder = join(dir, String(ids.length));
      mkdirSync(folder);
      const file = join(folder, name);
      writeFileSync(file, "synthetic archive bytes — not a database dump");
      const row = await prisma.backup.create({
        data: {
          backupPath: file,
          status: "completed",
          type: "full",
          createdAt: new Date(Date.now() - ageDays * 86_400_000),
        },
      });
      ids.push(row.id);
      return { ...row, remote: `/backups/${name}` };
    };
    const row = await make();
    await syncToCloud(row.id);
    assert.equal(
      objects.get(row.remote)?.toString(),
      "synthetic archive bytes — not a database dump"
    );
    assert((await prisma.backup.findUniqueOrThrow({ where: { id: row.id } })).cloudTarget);
    passed("real HTTP upload records target and exact bytes");
    for (const code of [401, 423, 500]) {
      deleteStatus = code;
      await assert.rejects(deleteBackup(row.id, true), { statusCode: 502 });
      assert(existsSync(row.backupPath));
      assert(objects.has(row.remote));
      assert.equal(
        (await prisma.backup.findUniqueOrThrow({ where: { id: row.id } })).cloudDeleteError,
        "REMOTE_DELETE_FAILED"
      );
      passed(`DELETE ${code} preserves local archive, database row and remote object`);
    }
    deleteStatus = 0;
    await updateWebDAVSettings({ backupPath: "/changed/" });
    const before = requests.filter((r) => r.method === "DELETE").length;
    await assert.rejects(deleteBackup(row.id, true), { statusCode: 409 });
    assert.equal(requests.filter((r) => r.method === "DELETE").length, before);
    assert(existsSync(row.backupPath));
    passed("changed target is refused before sending DELETE");
    await updateWebDAVSettings({ backupPath: "/backups/" });
    loseDeleteResponse = true;
    await assert.rejects(deleteBackup(row.id, true), { statusCode: 502 });
    assert(existsSync(row.backupPath));
    assert(!objects.has(row.remote));
    await deleteBackup(row.id, true); // 404 on retry is success.
    assert(!existsSync(row.backupPath));
    assert.equal(await prisma.backup.findUnique({ where: { id: row.id } }), null);
    passed("lost DELETE response can be retried safely after remote 404");
    const upload = await make();
    uploadStatus = 507;
    await assert.rejects(syncToCloud(upload.id), { statusCode: 502 });
    assert.equal(
      (await prisma.backup.findUniqueOrThrow({ where: { id: upload.id } })).syncedToCloud,
      false
    );
    assert(existsSync(upload.backupPath));
    uploadStatus = 0;
    await deleteBackup(upload.id);
    passed("upload failure does not claim a remote copy");
    const admin = await prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
    await prisma.adminSettings.update({
      where: { id: admin.id },
      data: { backupRetentionDays: 7, backupCloudRetention: false },
    });
    const newest = await make(10);
    const old = await make(20);
    await syncToCloud(newest.id);
    await syncToCloud(old.id);
    assert.equal(await cleanupOldBackups(), 1);
    assert(existsSync(newest.backupPath));
    assert(objects.has(old.remote));
    assert(!existsSync(old.backupPath));
    passed("local retention keeps newest full archive and leaves remote copies by default");
    const oldRemote = await make(30);
    await syncToCloud(oldRemote.id);
    await prisma.adminSettings.update({
      where: { id: admin.id },
      data: { backupCloudRetention: true },
    });
    deleteStatus = 423;
    assert.equal(await cleanupOldBackups(), 0);
    assert(existsSync(oldRemote.backupPath));
    deleteStatus = 0;
    assert.equal(await cleanupOldBackups(), 1);
    assert(!objects.has(oldRemote.remote));
    assert(existsSync(newest.backupPath));
    passed("opt-in cloud retention preserves failed deletions and succeeds on retry");
    await deleteBackup(newest.id); // Leave no full archive on disk.
    const missing = await make(40);
    rmSync(missing.backupPath);
    assert.equal(await cleanupOldBackups(), 0);
    assert(await prisma.backup.findUnique({ where: { id: missing.id } }));
    passed("retention refuses cleanup without a full archive on disk");
    console.log(`RESULT ${cases} scenarios passed; ${requests.length} loopback HTTP requests`);
  } finally {
    // Only rows/files created by this run; no existing backup is ever removed.
    if (ids.length) await prisma.backup.deleteMany({ where: { id: { in: ids } } });
    if (configured) {
      if (previous) {
        const {
          webdavSyncEnabled,
          webdavUrl,
          webdavUsername,
          webdavPasswordEncrypted,
          webdavBackupPath,
          backupRetentionDays,
          backupCloudRetention,
        } = previous;
        await prisma.adminSettings.update({
          where: { id: previous.id },
          data: {
            webdavSyncEnabled,
            webdavUrl,
            webdavUsername,
            webdavPasswordEncrypted,
            webdavBackupPath,
            backupRetentionDays,
            backupCloudRetention,
          },
        });
      } else await prisma.adminSettings.deleteMany({});
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "verification failed");
  process.exitCode = 1;
});
