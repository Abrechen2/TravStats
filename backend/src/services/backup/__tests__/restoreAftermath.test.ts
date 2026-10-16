import { prisma } from "../../../db";
import { restoreDatabaseThenSettle } from "../restoreAftermath";
import { suspendComparisonAfterRestore } from "../../federation/restore";

jest.mock("../../federation/restore", () => ({
  suspendComparisonAfterRestore: jest.fn().mockResolvedValue(undefined),
}));
const suspendComparison = jest.mocked(suspendComparisonAfterRestore);

/**
 * What a database restore owes this machine once psql has committed.
 *
 * psql replaces the whole `backups` table with the archive's copy. Until
 * 2026-10-16 only the restored archive's own row was put back, so every row
 * newer than the archive — the safety backup taken a second earlier among
 * them — vanished: its directory stayed on disk, unlisted and never cleaned.
 * And once psql had committed, a schema check that threw skipped everything
 * after it: the instance kept the archive's identity, the phones their stale
 * sync cursors, the archive its revived share links.
 *
 * The psql run is a stand-in here: what these tests hold is what happens
 * around it, which is what was broken.
 */
const PATH_PREFIX = "/tmp/restore-aftermath-";

const backupRow = (label: string, data: Record<string, unknown> = {}) =>
  prisma.backup.create({
    data: {
      status: "completed",
      backupPath: `${PATH_PREFIX}${label}/backup-${label}.tar.gz`,
      completedAt: new Date(),
      ...data,
    },
  });

const ownLanUrl = "http://192.168.0.10:3010";

async function setLanUrl(lanUrl: string | null): Promise<void> {
  const row = await prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
  await prisma.adminSettings.update({ where: { id: row.id }, data: { lanUrl } });
}

async function lanUrl(): Promise<string | null> {
  return (await prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } })).lanUrl;
}

describe("restoreDatabaseThenSettle", () => {
  let originalLanUrl: string | null;

  beforeAll(async () => {
    originalLanUrl = await lanUrl();
  });

  afterEach(async () => {
    await prisma.backup.deleteMany({ where: { backupPath: { startsWith: PATH_PREFIX } } });
    await setLanUrl(originalLanUrl);
    suspendComparison.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** The archive, the safety backup taken just before the restore, and what psql does to both. */
  async function scenario() {
    const archive = await backupRow("archive", { createdAt: new Date("2026-10-01T00:00:00Z") });
    const safety = await backupRow("safety", {
      syncedToCloud: true,
      cloudTarget: "own-target",
      cloudPath: "/TravStats/backups/backup-safety.tar.gz",
    });
    const psql = async () => {
      // The archive's `backups` table: written while the archive's own dump ran,
      // and from before the safety backup existed — plus a row of the instance
      // that wrote it.
      await prisma.backup.update({ where: { id: archive.id }, data: { status: "running" } });
      await prisma.backup.delete({ where: { id: safety.id } });
      await backupRow("foreign", {
        syncedToCloud: true,
        cloudTarget: "their-target",
        cloudPath: "/TravStats/backups/backup-foreign.tar.gz",
      });
      await setLanUrl("http://192.168.0.99:3010");
    };
    return { archive, safety, psql };
  }

  it("keeps every backup row this instance had, the safety backup included", async () => {
    const { archive, safety, psql } = await scenario();
    await setLanUrl(ownLanUrl);

    await restoreDatabaseThenSettle(archive, psql, async () => undefined);

    const { updatedAt: _u, ...expectedSafety } = safety;
    expect(await prisma.backup.findUnique({ where: { id: safety.id } })).toMatchObject(
      expectedSafety
    );
    expect((await prisma.backup.findUniqueOrThrow({ where: { id: archive.id } })).status).toBe(
      "completed"
    );
  });

  it("disowns the remote copy of a backup row only the archive knew", async () => {
    const { archive, psql } = await scenario();

    await restoreDatabaseThenSettle(archive, psql, async () => undefined);

    const foreign = await prisma.backup.findFirstOrThrow({
      where: { backupPath: { startsWith: `${PATH_PREFIX}foreign` } },
    });
    // Retention deletes remote copies only where the target is recorded; a
    // row from another instance must not let it reach that instance's share.
    expect(foreign.cloudTarget).toBeNull();
  });

  it("still puts this machine back when the schema check fails after psql committed", async () => {
    const { archive, safety, psql } = await scenario();
    await setLanUrl(ownLanUrl);
    const schemaError = new Error("sync triggers missing");

    await expect(
      restoreDatabaseThenSettle(archive, psql, async () => {
        throw schemaError;
      })
    ).rejects.toBe(schemaError);

    expect(await lanUrl()).toBe(ownLanUrl);
    expect(suspendComparison).toHaveBeenCalled();
    expect(await prisma.backup.findUnique({ where: { id: safety.id } })).not.toBeNull();
    expect((await prisma.backup.findUniqueOrThrow({ where: { id: archive.id } })).status).toBe(
      "completed"
    );
  });

  it("runs every later step when one of them fails, then reports the failure", async () => {
    const { archive, safety, psql } = await scenario();
    await setLanUrl(ownLanUrl);
    const stepError = new Error("comparison table locked");
    suspendComparison.mockRejectedValueOnce(stepError);

    await expect(restoreDatabaseThenSettle(archive, psql, async () => undefined)).rejects.toBe(
      stepError
    );

    expect(await lanUrl()).toBe(ownLanUrl);
    expect(await prisma.backup.findUnique({ where: { id: safety.id } })).not.toBeNull();
  });

  it("settles nothing when psql itself failed, because nothing was replaced", async () => {
    const archive = await backupRow("archive");
    const psqlError = new Error("psql exited with code 3");

    await expect(
      restoreDatabaseThenSettle(
        archive,
        async () => {
          throw psqlError;
        },
        async () => undefined
      )
    ).rejects.toBe(psqlError);

    expect(suspendComparison).not.toHaveBeenCalled();
  });
});
